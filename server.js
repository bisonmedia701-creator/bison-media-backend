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

// Landing page with Call Me button
app.get('/call/:name', (req, res) => {
    const name = req.params.name.replace(/-/g, ' ');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #1a1a2e, #16213e); min-height: 100vh; color: white; }
                .container { max-width: 500px; margin: 0 auto; }
                h1 { color: #00d4ff; margin-bottom: 10px; }
                .prize { font-size: 3rem; margin: 30px 0; }
                .btn { background: #00d4ff; color: #1a1a2e; padding: 20px 50px; font-size: 1.5rem; border: none; border-radius: 50px; cursor: pointer; text-decoration: none; display: inline-block; margin: 20px 0; }
                .btn:hover { background: #00ff88; }
                .hidden { display: none; }
                .success { background: #00ff88; color: #1a1a2e; padding: 30px; border-radius: 20px; margin-top: 30px; }
                .note { color: #888; margin-top: 20px; font-size: 0.9rem; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎉 Congratulations, ${name}!</h1>
                <p>You've won a <strong>Scratch & Win Prize</strong> from GT Auto Sales!</p>
                <div class="prize">🚗🏆🎁</div>
                <p>Click below to claim your prize and schedule your test drive!</p>
                <button class="btn" onclick="callMe()">📞 Call Me Now</button>
                <div id="success" class="hidden success">
                    <h2>✓ Sarah is calling you!</h2>
                    <p>Answer your phone to speak with Sarah.</p>
                </div>
                <div id="error" class="hidden" style="color: #ff4444; margin-top: 20px;">
                    <p>Please enter your phone number below:</p>
                    <input type="tel" id="phone" placeholder="+1 555-123-4567" style="padding: 15px; font-size: 1rem; border-radius: 10px; width: 80%;">
                    <br><br>
                    <button class="btn" onclick="callWithPhone()">📞 Call Me</button>
                </div>
                <p class="note">Sarah will call you and schedule your appointment!</p>
            </div>
            <script>
                async function callMe() {
                    try {
                        const response = await fetch('/api/call/${req.params.name}');
                        const data = await response.json();
                        if (data.success) {
                            document.getElementById('success').classList.remove('hidden');
                            document.querySelector('.btn').style.display = 'none';
                        } else if (data.needsPhone) {
                            document.getElementById('error').classList.remove('hidden');
                            document.querySelector('.btn').style.display = 'none';
                        }
                    } catch (e) {
                        document.getElementById('error').classList.remove('hidden');
                        document.querySelector('.btn').style.display = 'none';
                    }
                }
                async function callWithPhone() {
                    const phone = document.getElementById('phone').value;
                    if (!phone) return alert('Please enter your phone number');
                    await fetch('/api/call/${req.params.name}', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phone })
                    });
                    document.getElementById('error').innerHTML = '<div class="success"><h2>✓ Sarah is calling ' + phone + '!</h2><p>Answer your phone!</p></div>';
                }
            </script>
        </body>
        </html>
    `);
});

// Initiate call to contact
app.post('/api/call/:name', async (req, res) => {
    const name = req.params.name.replace(/-/g, ' ');
    let phone = req.body.phone;

    if (!phone) {
        // Look up phone from contacts
        const contact = contacts.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (contact && contact.phone) {
            phone = contact.phone;
        } else {
            return res.json({ success: false, needsPhone: true });
        }
    }

    try {
        await twilioClient.calls.create({
            url: `${BASE_URL}/voice/greet?name=${encodeURIComponent(name)}`,
            to: phone,
            from: process.env.TWILIO_PHONE_NUMBER
        });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Sarah greets by name
app.post('/voice/greet', (req, res) => {
    const name = req.query.name || 'there';
    const twiml = new VoiceResponse();

    twiml.say({ voice: 'alice' },
        `Hi ${name}! This is Sarah from GT Auto Sales. Congratulations on your scratch and win prize! I'm calling to help you schedule your test drive. Is this a good time to talk? Press 1 for yes, or press 2 to schedule a callback.`);

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
    const name = req.body.name || 'there';

    if (digit === '1') {
        twiml.say({ voice: 'alice' },
            `Great! We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Which time works best for you? Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.`);

        twiml.gather({
            input: 'dtmf',
            numDigits: 1,
            timeout: 30,
            action: `${BASE_URL}/voice/book`
        });
    } else {
        twiml.say({ voice: 'alice' }, `No problem! Have a great day!`);
        twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/book', async (req, res) => {
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

    for (const contact of contacts) {
        const safeName = contact.name.replace(/\s+/g, '-');
        const qrUrl = `${BASE_URL}/call/${safeName}`;
        await QRCode.toFile(`qrcodes/${safeName}.png`, qrUrl, { width: 400, margin: 2 });
    }

    res.json({ success: true, count: contacts.length });
});

app.listen(PORT, () => console.log('Server running on port', PORT));
