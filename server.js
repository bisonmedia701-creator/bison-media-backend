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

// Landing page with phone number input + Call button
app.get('/call/:name', (req, res) => {
    const name = req.params.name.replace(/-/g, ' ');
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 30px; background: linear-gradient(135deg, #1a1a2e, #16213e); min-height: 100vh; color: white; margin: 0; }
        .container { max-width: 500px; margin: 0 auto; }
        h1 { color: #00d4ff; margin-bottom: 10px; font-size: 2rem; }
        .prize { font-size: 4rem; margin: 20px 0; }
        .card { background: rgba(255,255,255,0.1); padding: 30px; border-radius: 20px; margin: 20px 0; }
        .phone-input { width: 100%; padding: 15px; font-size: 1.2rem; border-radius: 10px; border: 2px solid #00d4ff; text-align: center; box-sizing: border-box; }
        .btn { background: #00d4ff; color: #1a1a2e; padding: 15px 40px; font-size: 1.2rem; border: none; border-radius: 50px; cursor: pointer; width: 100%; margin-top: 15px; font-weight: bold; }
        .btn:hover { background: #00ff88; }
        .note { color: #888; font-size: 0.9rem; margin-top: 15px; }
        .success { background: #00ff88; color: #1a1a2e; padding: 20px; border-radius: 15px; margin-top: 20px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎉 Congratulations, ${name}!</h1>
        <p>You've won a <strong>Scratch & Win Prize</strong> from GT Auto Sales!</p>
        <div class="prize">🚗🏆🎁</div>
        
        <div class="card">
            <p>Enter your phone number below and Sarah will call you to schedule your appointment!</p>
            <input type="tel" id="phone" class="phone-input" placeholder="Enter your phone (e.g., +1 555-123-4567)">
            <button class="btn" onclick="callSarah()">📞 Sarah, Call Me Now!</button>
            <p class="note">Sarah will call you and greet you by name!</p>
        </div>
        
        <div id="success" style="display:none;" class="success">
            <h2>✓ Sarah is calling you now!</h2>
            <p>Answer your phone to speak with Sarah.</p>
        </div>
        
        <div id="error" style="display:none; color: #ff4444; margin-top: 15px;"></div>
    </div>
    
    <script>
        async function callSarah() {
            const phone = document.getElementById('phone').value;
            if (!phone || phone.length < 10) {
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').textContent = 'Please enter a valid phone number';
                return;
            }
            
            try {
                const response = await fetch('/api/call/${req.params.name}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: phone })
                });
                const data = await response.json();
                
                if (data.success) {
                    document.querySelector('.card').style.display = 'none';
                    document.getElementById('success').style.display = 'block';
                } else {
                    document.getElementById('error').style.display = 'block';
                    document.getElementById('error').textContent = 'Error: ' + (data.error || 'Please try again');
                }
            } catch (e) {
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').textContent = 'Connection error. Please try again.';
            }
        }
    </script>
</body>
</html>
    `);
});

// Initiate call - Sarah CALLS the person
app.post('/api/call/:name', async (req, res) => {
    const name = req.params.name.replace(/-/g, ' ');
    const phone = req.body.phone;

    if (!phone) {
        return res.json({ success: false, error: 'Phone number required' });
    }

    try {
        // Sarah calls the person
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

// Sarah greets by NAME
app.post('/voice/greet', (req, res) => {
    const name = req.query.name || 'there';
    const twiml = new VoiceResponse();

    twiml.say({ voice: 'alice' },
        `Hi ${name}! This is Sarah from GT Auto Sales. Congratulations on your scratch and win prize! I'm calling to help you schedule your test drive. Is this a good time to talk? Press 1 for yes, or press 2 for a callback.`);

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
                body: `Your GT Auto appointment is confirmed for ${timeSlot} Saturday! https://4u95lgtba68e.space.minimax.io`,
                from: process.env.TWILIO_PHONE_NUMBER,
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
