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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/qrcodes', express.static('qrcodes'));

// Ensure directories exist
['uploads', 'qrcodes', 'data'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Multer setup for CSV uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `contacts_${Date.now()}.csv`)
});
const upload = multer({ storage });

// In-memory contact storage
let contacts = [
    { id: 1, firstName: 'Eric', lastName: 'Lorentzen', phone: '2535346321', email: '', source: 'test', qrCodeUrl: null, createdAt: new Date().toISOString() },
    { id: 2, firstName: 'Frank', lastName: 'Colasino', phone: '3125764444', email: '', source: 'test', qrCodeUrl: null, createdAt: new Date().toISOString() },
    { id: 3, firstName: 'Drew', lastName: 'Balogh', phone: '2535498860', email: '', source: 'test', qrCodeUrl: null, createdAt: new Date().toISOString() },
    { id: 4, firstName: 'Priscilla', lastName: 'Watts', phone: '2539547398', email: '', source: 'test', qrCodeUrl: null, createdAt: new Date().toISOString() }
];
let appointments = [];
let phoneLookup = {
    '2535346321': 'Eric Lorentzen',
    '3125764444': 'Frank Colasino',
    '2535498860': 'Drew Balogh',
    '2539547398': 'Priscilla Watts'
};

// Initialize Twilio client
let twilioClient = null;
let VoiceResponse = null;

try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        VoiceResponse = twilio.twiml.VoiceResponse;
        console.log('Twilio client initialized');
    } else {
        console.warn('Twilio credentials not configured');
    }
} catch (err) {
    console.error('Twilio initialization error:', err.message);
}

// ============ API ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// QR Code call endpoint - Shows browser-based Sarah (no phone call)
app.get('/call/:name', (req, res) => {
    const name = req.params.name;
    res.redirect(`/voice.html?name=${encodeURIComponent(name)}`);
});

// Upload CSV with contacts
app.post('/api/contacts/upload', upload.single('file'), async (req, res) => {
    try {
        const results = [];
        const filePath = req.file.path;

        fs.createReadStream(filePath).pipe(csvParser()).on('data', (data) => results.push(data)).on('end', async () => {
            contacts = results.map((row, index) => ({
                id: index + 1,
                firstName: row.firstName || row.FirstName || row['First Name'] || row.name?.split(' ')[0] || '',
                lastName: row.lastName || row.LastName || row['Last Name'] || row.name?.split(' ').slice(1).join(' ') || '',
                phone: (row.phone || row.Phone || row.phoneNumber || row['Phone Number'] || '').replace(/\D/g, ''),
                email: row.email || row.Email || '',
                source: 'csv',
                qrCodeUrl: null,
                createdAt: new Date().toISOString()
            }));

            // Build phone lookup
            phoneLookup = {};
            contacts.forEach(c => {
                if (c.phone) phoneLookup[c.phone] = `${c.firstName} ${c.lastName}`.trim();
            });

            // Generate QR codes
            const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
            for (let contact of contacts) {
                const fullName = `${contact.firstName}-${contact.lastName}`;
                const qrCodePath = `qrcodes/${contact.id}_${fullName}.png`;
                await QRCode.toFile(qrCodePath, `${baseUrl}/call/${fullName}`, { width: 400, margin: 2 });
                contact.qrCodeUrl = `/${qrCodePath}`;
            }

            fs.writeFileSync('data/contacts.json', JSON.stringify(contacts, null, 2));
            res.json({ success: true, count: contacts.length, contacts: contacts.slice(0, 10) });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all contacts
app.get('/api/contacts', (req, res) => {
    res.json({ contacts, total: contacts.length });
});

// ============ TWILIO WEBHOOKS ============

app.post('/voice/status', (req, res) => {
    console.log(`Call status: ${req.body.CallStatus}`);
    res.status(200).send('OK');
});

// Incoming call webhook - Sarah answers and greets by NAME
app.post('/voice/incoming', (req, res) => {
    if (!VoiceResponse) return res.status(500).send('Server not configured');

    const twiml = new VoiceResponse();
    const baseUrl = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';
    const callerPhone = (req.body.From || '').replace(/\D/g, '');
    const callerName = phoneLookup[callerPhone] || 'there';
    const firstName = callerName.split(' ')[0];

    twiml.say({ voice: 'alice', language: 'en-US' },
        `Hi ${firstName}! This is Sarah from GT Auto Sales. Congratulations on your scratch and win prize! Press 1 to schedule a test drive, or press 2 to call us back later.`);

    twiml.gather({
        input: 'dtmf',
        action: `${baseUrl}/voice/gather`,
        method: 'POST',
        numDigits: 1,
        timeout: 30
    });

    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/gather', async (req, res) => {
    if (!VoiceResponse) return res.status(500).send('Server not configured');

    const { Digits, From } = req.body;
    const twiml = new VoiceResponse();
    const baseUrl = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';
    const callerPhone = (From || '').replace(/\D/g, '');
    const callerName = phoneLookup[callerPhone] || 'there';
    const firstName = callerName.split(' ')[0];

    if (Digits === '1') {
        twiml.say({ voice: 'alice' },
            `Great, ${firstName}! We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Press 1 for 10 AM, press 2 for 2 PM, press 3 for 4 PM.`);

        twiml.gather({
            input: 'dtmf',
            action: `${baseUrl}/voice/confirm`,
            method: 'POST',
            numDigits: 1,
            timeout: 30
        });
    } else {
        twiml.say({ voice: 'alice' }, `No problem, ${firstName}! Have a great day!`);
        twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
});

app.post('/voice/confirm', async (req, res) => {
    if (!VoiceResponse) return res.status(500).send('Server not configured');

    const { Digits, From } = req.body;
    const twiml = new VoiceResponse();
    const callerPhone = (From || '').replace(/\D/g, '');
    const callerName = phoneLookup[callerPhone] || 'there';
    const firstName = callerName.split(' ')[0];

    let timeSlot = '10 AM';
    if (Digits === '2') timeSlot = '2 PM';
    else if (Digits === '3') timeSlot = '4 PM';

    appointments.push({
        id: appointments.length + 1,
        name: callerName,
        phone: From,
        time: timeSlot,
        date: 'Saturday',
        status: 'confirmed',
        createdAt: new Date().toISOString()
    });

    try {
        fs.writeFileSync('data/appointments.json', JSON.stringify(appointments, null, 2));
    } catch (e) {}

    twiml.say({ voice: 'alice' },
        `Perfect, ${firstName}! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you!`);

    if (From) {
        try {
            await twilioClient.messages.create({
                body: `Hi ${firstName}! Your GT Auto appointment is confirmed for ${timeSlot} Saturday. Can't wait to see you!`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: From
            });
        } catch (smsError) {
            console.log('SMS error:', smsError.message);
        }
    }

    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
});

// ============ BROWSER-BASED SARAH (No Phone Call) ============

app.post('/api/sarah/chat', async (req, res) => {
    const { message, customerName } = req.body;
    const firstName = customerName?.split(' ')[0] || 'there';

    const msg = (message || '').toLowerCase();
    let response;

    if (msg.includes('yes') || msg.includes('book') || msg.includes('schedule') || msg.includes('appointment')) {
        response = `Great, ${firstName}! I can help you book a test drive. Would you prefer 10 AM, 2 PM, or 4 PM this Saturday?`;
    } else if (msg.includes('10') || msg.includes('morning')) {
        response = `Perfect! 10 AM reserved for you, ${firstName}. Would you like me to confirm your appointment?`;
    } else if (msg.includes('2') || msg.includes('afternoon')) {
        response = `Excellent choice, ${firstName}! 2 PM works great. Should I confirm your appointment?`;
    } else if (msg.includes('4') || msg.includes('evening')) {
        response = `Wonderful, ${firstName}! 4 PM it is. Would you like me to confirm your appointment?`;
    } else if (msg.includes('confirm') || msg.includes('yes') || msg.includes('yeah')) {
        response = '__CONFIRM_APPOINTMENT__';
    } else if (msg.includes('no') || msg.includes('not') || msg.includes('maybe') || msg.includes('later')) {
        response = `No problem, ${firstName}! Feel free to visit us anytime or call (888) 308-9827. Have a great day!`;
    } else {
        response = `Hi ${firstName}! I'm Sarah from GT Auto Sales. Would you like to schedule a test drive this Saturday? I have availability at 10 AM, 2 PM, or 4 PM.`;
    }

    const showAppointmentForm = response.includes('10 AM') || response.includes('2 PM') || response.includes('4 PM') || response === '__CONFIRM_APPOINTMENT__';
    res.json({ response: response.replace('__CONFIRM_APPOINTMENT__', 'Great! Please select a time slot below to confirm your appointment.'), showAppointmentForm });
});

app.post('/api/appointments/book', async (req, res) => {
    const { customerName, time, date } = req.body;

    appointments.push({
        id: appointments.length + 1,
        name: customerName,
        phone: '',
        time: time,
        date: date,
        status: 'confirmed',
        source: 'browser',
        createdAt: new Date().toISOString()
    });

    try {
        fs.writeFileSync('data/appointments.json', JSON.stringify(appointments, null, 2));
    } catch (e) {}

    res.json({ success: true, appointmentId: appointments.length });
});

app.get('/api/appointments', (req, res) => {
    res.json({ appointments, total: appointments.length });
});

// ============ QR CODE GENERATION ============

async function initQRCodes() {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    if (!fs.existsSync('qrcodes')) fs.mkdirSync('qrcodes', { recursive: true });

    for (const contact of contacts) {
        const fullName = `${contact.firstName}-${contact.lastName}`;
        const qrCodePath = `qrcodes/${fullName}.png`;

        try {
            await QRCode.toFile(qrCodePath, `${baseUrl}/call/${fullName}`, { width: 400, margin: 2 });
            console.log(`QR code generated for ${contact.firstName} ${contact.lastName}`);
        } catch (e) {
            console.log(`QR skipped for ${contact.firstName}`);
        }
    }
}

// Start server
app.listen(PORT, async () => {
    console.log(`QR AI Voice Server running on port ${PORT}`);
    console.log(`Test contacts: Eric, Frank, Drew, Priscilla`);
    console.log(`Browser Sarah: /call/Name redirects to voice.html`);
    console.log(`Test URLs:`);
    contacts.forEach(c => {
        console.log(`   ${process.env.BASE_URL || 'https://bison-media-backend.onrender.com'}/call/${c.firstName}-${c.lastName}`);
    });
    await initQRCodes();
});

export default app;
