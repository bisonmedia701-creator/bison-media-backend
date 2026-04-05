import express from 'express';
import cors from 'cors';
import multer from 'multer';
import csvParser from 'csv-parser';
import QRCode from 'qrcode';
import twilio from 'twilio';
import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/qrcodes', express.static('qrcodes'));

['uploads', 'qrcodes', 'data'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `contacts_${Date.now()}.csv`)
});
const upload = multer({ storage });

let contacts = [];
let appointments = [];

let twilioClient = null;
let VoiceResponse = null;

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    VoiceResponse = twilio.twiml.VoiceResponse;
}

let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), twilio: { configured: !!VoiceResponse, phoneNumber: process.env.TWILIO_PHONE_NUMBER } });
});

app.post('/api/contacts/upload', upload.single('file'), async (req, res) => {
    try {
        const results = [];
        fs.createReadStream(req.file.path).pipe(csvParser()).on('data', (data) => results.push(data)).on('end', async () => {
            contacts = results.map((row, index) => ({
                id: index + 1,
                firstName: row.firstName || row.FirstName || row['First Name'] || row.name?.split(' ')[0] || '',
                lastName: row.lastName || row.LastName || row['Last Name'] || row.name?.split(' ').slice(1).join(' ') || '',
                phone: row.phone || row.Phone || row.phoneNumber || row['Phone Number'] || '',
                email: row.email || row.Email || row['Email Address'] || '',
                source: 'csv',
                qrCodeUrl: null,
                createdAt: new Date().toISOString()
            }));
            
            for (let contact of contacts) {
                const qrData = JSON.stringify({ contactId: contact.id, phone: contact.phone, name: `${contact.firstName} ${contact.lastName}` });
                const qrCodePath = `qrcodes/contact_${contact.id}_${Date.now()}.png`;
                await QRCode.toFile(qrCodePath, qrData, { color: { dark: '#000000', light: '#ffffff' }, width: 300, margin: 2 });
                contact.qrCodeUrl = `/${qrCodePath}`;
            }
            
            fs.writeFileSync('data/contacts.json', JSON.stringify(contacts, null, 2));
            res.json({ success: true, count: contacts.length, contacts: contacts.slice(0, 10) });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/contacts', (req, res) => res.json({ contacts, total: contacts.length }));
app.get('/api/contacts/:id', (req, res) => {
    const contact = contacts.find(c => c.id === parseInt(req.params.id));
    contact ? res.json(contact) : res.status(404).json({ error: 'Contact not found' });
});

app.post('/voice/status', (req, res) => { res.status(200).send('OK'); });

app.post('/voice/incoming', (req, res) => {
    if (!VoiceResponse) return res.status(500).send('Server not configured');
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'alice', language: 'en-US' }, `Thank you for calling GT Auto Sales! This is Sarah, and congratulations on your scratch and win prize! Are you interested in scheduling a test drive or visiting our dealership today? Press 1 for yes.`);
    twiml.gather({ input: 'speech dtmf', action: '/voice/gather', method: 'POST', speechTimeout: 10, bargeIn: true, numDigits: 1 });
    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/gather', async (req, res) => {
    if (!VoiceResponse) return res.status(500).send('Server not configured');
    const { Digits, SpeechResult, From } = req.body;
    const twiml = new VoiceResponse();
    const response = SpeechResult || '';
    const isInterested = response.toLowerCase().includes('yes') || response.toLowerCase().includes('interested') || response.toLowerCase().includes('appointment') || response.toLowerCase().includes('test drive') || response.toLowerCase().includes('schedule') || Digits === '1';
    
    if (isInterested) {
        twiml.say({ voice: 'alice' }, `Great! I'd love to help you book your appointment. We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.`);
        twiml.gather({ input: 'dtmf', action: '/voice/confirm', method: 'POST', numDigits: 1, timeout: 15 });
    } else {
        twiml.say({ voice: 'alice' }, `No problem! Feel free to call us back if you change your mind. Visit our website to claim your scratch and win prize online. Have a great day!`);
        twiml.hangup();
    }
    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/confirm', async (req, res) => {
    if (!VoiceResponse) return res.status(500).send('Server not configured');
    const { Digits, From } = req.body;
    const twiml = new VoiceResponse();
    let timeSlot = '10 AM';
    if (Digits === '2') timeSlot = '2 PM';
    else if (Digits === '3') timeSlot = '4 PM';
    
    const appointment = { id: appointments.length + 1, phone: From, time: timeSlot, date: 'Saturday', status: 'confirmed', createdAt: new Date().toISOString() };
    appointments.push(appointment);
    
    twiml.say({ voice: 'alice' }, `Perfect! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you! You'll receive a text message with all the details. Thank you for calling GT Auto Sales!`);
    
    if (From) {
        try {
            await twilioClient.messages.create({
                body: `Hi! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. Claim your scratch & win prize: ${process.env.LANDING_PAGE_URL || 'https://4u95lgtba68e.space.minimax.io'}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: From
            });
        } catch (smsError) { console.log('SMS could not be sent:', smsError.message); }
    }
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
});

app.get('/api/appointments', (req, res) => res.json({ appointments, total: appointments.length }));

app.post('/api/calls/initiate', async (req, res) => {
    const { contactId } = req.body;
    const contact = contacts.find(c => c.id === parseInt(contactId));
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    if (!contact.phone) return res.status(400).json({ error: 'Contact has no phone number' });
    
    try {
        const call = await twilioClient.calls.create({
            url: `${process.env.BASE_URL}/voice/incoming`,
            to: contact.phone,
            from: process.env.TWILIO_PHONE_NUMBER
        });
        res.json({ success: true, callSid: call.sid, status: call.status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Twilio webhooks: /voice/incoming`);
});
export default app;
