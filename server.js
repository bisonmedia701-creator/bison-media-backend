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
app.use(express.urlencoded({ extended: true }));
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

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const VoiceResponse = twilio.twiml.VoiceResponse;

const BASE_URL = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';
const TWILIO_PHONE = '+18883089827';

// AUTO-CALL PAGE - No button, auto dials Sarah when page loads
app.get('/call/:name', (req, res) => {
    const name = req.params.name.replace(/-/g, ' ');

    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="refresh" content="0;url=tel:${TWILIO_PHONE}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #1a1a2e, #16213e); min-height: 100vh; color: white; margin: 0; }
        .container { max-width: 400px; margin: 0 auto; }
        h1 { color: #00d4ff; font-size: 1.5rem; }
        .spinner { border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid #00d4ff; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 30px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .note { color: #888; font-size: 0.9rem; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎉 Congratulations, ${name}!</h1>
        <p>Connecting you to Sarah...</p>
        <div class="spinner"></div>
        <p>Sarah will greet you by name!</p>
        <p class="note">If phone doesn't dial automatically, <a href="tel:${TWILIO_PHONE}" style="color:#00d4ff;">click here</a></p>
    </div>
</body>
</html>
    `);
});

app.post('/voice/incoming', (req, res) => {
    const twiml = new VoiceResponse();
    const callerName = req.query.name || 'there';

    twiml.say({ voice: 'alice' },
        `Hi ${callerName}! This is Sarah from GT Auto Sales. Congratulations on your scratch and win prize! I'm calling to help you schedule your test drive. Is this a good time to talk? Press 1 for yes, or press 2 for a callback.`);

    twiml.gather({
        input: 'dtmf',
        numDigits: 1,
        timeout: 30,
        action: `${BASE_URL}/voice/respond`
    });

    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/respond', (req, res) => {
    const twiml = new VoiceResponse();
    const digit = req.body.Digits;

    if (digit === '1') {
        twiml.say({ voice: 'alice' },
            `Great! I'd love to help you book your appointment. We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Which time works best for you? Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.`);

        twiml.gather({
            input: 'dtmf',
            numDigits: 1,
            timeout: 30,
            action: `${BASE_URL}/voice/confirm`
        });
    } else {
        twiml.say({ voice: 'alice' }, `No problem! Have a great day!`);
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
                body: `Your GT Auto appointment is confirmed for ${timeSlot} Saturday! https://4u95lgtba68e.space.minimax.io`,
                from: TWILIO_PHONE,
                to: from
            });
        } catch (e) {}
    }

    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
});

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

    for (const contact of contacts) {
        const safeName = contact.name.replace(/\s+/g, '-');
        await QRCode.toFile(`qrcodes/${safeName}.png`, `${BASE_URL}/call/${safeName}`, { width: 400, margin: 2 });
    }

    res.json({ success: true, count: contacts.length });
});

app.listen(PORT, () => console.log('Server running on port', PORT));
