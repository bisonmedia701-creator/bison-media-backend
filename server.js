import express from 'express';
import cors from 'cors';
import multer from 'multer';
import csvParser from 'csv-parser';
import QRCode from 'qrcode';
import twilio from 'twilio';
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

const BASE_URL = 'https://bison-media-backend.onrender.com';

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', twilio: !!twilioClient });
});

app.post('/voice/incoming', (req, res) => {
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'alice' }, 
        'Thank you for calling GT Auto Sales! This is Sarah, and congratulations on your scratch and win prize! Press 1 if you are interested in scheduling a test drive or visiting our dealership today.');
    twiml.gather({ input: 'dtmf', numDigits: 1, timeout: 30, action: `${BASE_URL}/voice/gather` });
    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/gather', (req, res) => {
    const twiml = new VoiceResponse();
    const digit = req.body.Digits;
    
    if (digit === '1') {
        twiml.say({ voice: 'alice' },
            'Great! I can help you schedule an appointment. We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.');
        twiml.gather({ input: 'dtmf', numDigits: 1, timeout: 30, action: `${BASE_URL}/voice/confirm` });
    } else {
        twiml.say({ voice: 'alice' }, 'No problem! Have a great day!');
        twiml.hangup();
    }
    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/confirm', async (req, res) => {
    const twiml = new VoiceResponse();
    const digit = req.body.Digits;
    const from = req.body.From;
    
    let timeSlot = '10 AM';
    if (digit === '2') timeSlot = '2 PM';
    else if (digit === '3') timeSlot = '4 PM';
    
    appointments.push({ phone: from, time: timeSlot, date: 'Saturday', status: 'confirmed' });
    
    twiml.say({ voice: 'alice' },
        `Perfect! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you! You will receive a text message shortly. Thank you!`);
    
    if (from && twilioClient) {
        try {
            await twilioClient.messages.create({
                body: `Your GT Auto appointment is confirmed for ${timeSlot} Saturday! Visit us soon: https://4u95lgtba68e.space.minimax.io`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: from
            });
        } catch (e) { console.log('SMS error:', e.message); }
    }
    
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
});

app.get('/api/appointments', (req, res) => res.json({ appointments }));

app.post('/api/contacts/upload', upload.single('file'), async (req, res) => {
    const results = [];
    fs.createReadStream(req.file.path).pipe(csvParser()).on('data', d => results.push(d));
    contacts = results.map((row, i) => ({ id: i+1, name: row.firstName || row.Name || '', phone: row.phone || row.Phone || '' }));
    res.json({ success: true, count: contacts.length });
});

app.get('/api/contacts', (req, res) => res.json({ contacts }));

app.listen(PORT, () => console.log('Server running on port', PORT));

export default app;
