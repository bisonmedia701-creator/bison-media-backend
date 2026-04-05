import express from 'express';
import cors from 'cors';
import multer from 'multer';
import csvParser from 'csv-parser';
import QRCode from 'qrcode';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/qrcodes', express.static('qrcodes'));
app.use(express.static('public'));

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

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const VoiceResponse = twilio.twiml.VoiceResponse;

const BASE_URL = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', phone: process.env.TWILIO_PHONE_NUMBER });
});

// QR Code call endpoint - Greet person by NAME
app.get('/call/:name', (req, res) => {
    const twiml = new VoiceResponse();
    const name = req.params.name.replace(/-/g, ' ');

    twiml.say({ voice: 'alice' },
        `Hi ${name}! This is Sarah from GT Auto Sales. Congratulations on your scratch and win prize! I'm calling to help you schedule your test drive. Is this a good time to talk? Press 1 for yes, or press 2 to schedule a callback.`);

    twiml.gather({
        input: 'dtmf',
        numDigits: 1,
        timeout: 30,
        action: `${BASE_URL}/call/${req.params.name}/response`
    });

    res.type('text/xml').send(twiml.toString());
});

// Handle response from QR call
app.post('/call/:name/response', (req, res) => {
    const twiml = new VoiceResponse();
    const digit = req.body.Digits;
    const name = req.params.name.replace(/-/g, ' ');

    if (digit === '1') {
        twiml.say({ voice: 'alice' },
            `Great, ${name}! I'd love to help you book your appointment. We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Which time works best for you? Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.`);

        twiml.gather({
            input: 'dtmf',
            numDigits: 1,
            timeout: 30,
            action: `${BASE_URL}/call/${req.params.name}/confirm`
        });
    } else {
        twiml.say({ voice: 'alice' }, `No problem, ${name}! We'll call you back at a more convenient time. Have a great day!`);
        twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
});

// Confirm appointment from QR call
app.post('/call/:name/confirm', async (req, res) => {
    const twiml = new VoiceResponse();
    const digit = req.body.Digits;
    const from = req.body.From;
    const name = req.params.name.replace(/-/g, ' ');

    let timeSlot = '10 AM';
    if (digit === '2') timeSlot = '2 PM';
    else if (digit === '3') timeSlot = '4 PM';

    appointments.push({ name: name, phone: from, time: timeSlot, date: 'Saturday', status: 'confirmed' });

    twiml.say({ voice: 'alice' },
        `Perfect, ${name}! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you!`);

    if (from) {
        try {
            await twilioClient.messages.create({
                body: `Hi ${name}! Your GT Auto appointment is confirmed for ${timeSlot} Saturday. Can't wait to see you! https://4u95lgtba68e.space.minimax.io`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: from
            });
        } catch (e) { console.log('SMS error:', e.message); }
    }

    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
});

// Generic incoming call
app.post('/voice/incoming', (req, res) => {
    const twiml = new VoiceResponse();

    twiml.say({ voice: 'alice' },
        'Thank you for calling GT Auto Sales! This is Sarah, and congratulations on your scratch and win prize! Press 1 if you are interested in scheduling a test drive.');

    twiml.gather({
        input: 'dtmf',
        numDigits: 1,
        timeout: 30,
        action: `${BASE_URL}/voice/gather`
    });

    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/gather', (req, res) => {
    const twiml = new VoiceResponse();
    const digit = req.body.Digits;

    if (digit === '1') {
        twiml.say({ voice: 'alice' },
            'Great! We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.');

        twiml.gather({
            input: 'dtmf',
            numDigits: 1,
            timeout: 30,
            action: `${BASE_URL}/voice/confirm`
        });
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
        `Perfect! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you!`);

    if (from) {
        try {
            await twilioClient.messages.create({
                body: `Your GT Auto appointment is confirmed for ${timeSlot} Saturday! Visit: https://4u95lgtba68e.space.minimax.io`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: from
            });
        } catch (e) { console.log('SMS error:', e.message); }
    }

    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
});

// API Routes
app.get('/api/appointments', (req, res) => res.json({ appointments }));
app.get('/api/contacts', (req, res) => res.json({ contacts }));

app.post('/api/contacts/upload', upload.single('file'), async (req, res) => {
    const results = [];
    fs.createReadStream(req.file.path).pipe(csvParser()).on('data', d => results.push(d));
    
    contacts = results.map((row, i) => ({
        id: i + 1,
        name: row.firstName || row.FirstName || row.Name || `Person ${i + 1}`,
        phone: row.phone || row.Phone || ''
    }));

    // Generate QR codes for each contact
    for (const contact of contacts) {
        const safeName = contact.name.replace(/\s+/g, '-');
        const qrUrl = `${BASE_URL}/call/${safeName}`;
        const qrPath = `qrcodes/${safeName}.png`;
        
        await QRCode.toFile(qrPath, qrUrl, {
            color: { dark: '#000000', light: '#ffffff' },
            width: 400,
            margin: 2
        });
    }

    res.json({ success: true, count: contacts.length });
});

app.listen(PORT, () => console.log('Server running on port', PORT));
