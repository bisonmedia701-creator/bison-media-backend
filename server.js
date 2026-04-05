import express from 'express';
import cors from 'cors';
import multer from 'multer';
import csvParser from 'csv-parser';
import QRCode from 'qrcode';
import twilio from 'twilio';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
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
let contacts = [];
let appointments = [];

// Initialize Twilio client
let twilioClient = null;
let VoiceResponse = null;

try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        twilioClient = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );
        VoiceResponse = twilio.twiml.VoiceResponse;
        console.log('Twilio client initialized');
    } else {
        console.warn('Twilio credentials not configured');
    }
} catch (err) {
    console.error('Twilio initialization error:', err.message);
}

// Initialize OpenAI client
let openai = null;
try {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        console.log('OpenAI client initialized');
    } else {
        console.warn('OpenAI API key not configured');
    }
} catch (err) {
    console.error('OpenAI initialization error:', err.message);
}

// ============ API ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        twilio: {
            configured: !!twilioClient,
            phoneNumber: process.env.TWILIO_PHONE_NUMBER
        }
    });
});

// Upload CSV with contacts
app.post('/api/contacts/upload', upload.single('file'), async (req, res) => {
    try {
        const results = [];
        const filePath = req.file.path;

        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
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

                // Generate QR codes for each contact
                const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

                for (let contact of contacts) {
                    const qrData = JSON.stringify({
                        contactId: contact.id,
                        phone: contact.phone,
                        name: `${contact.firstName} ${contact.lastName}`
                    });

                    const qrCodePath = `qrcodes/contact_${contact.id}_${Date.now()}.png`;
                    await QRCode.toFile(qrCodePath, qrData, {
                        color: { dark: '#000000', light: '#ffffff' },
                        width: 300,
                        margin: 2
                    });

                    contact.qrCodeUrl = `/${qrCodePath}`;
                }

                fs.writeFileSync('data/contacts.json', JSON.stringify(contacts, null, 2));

                res.json({
                    success: true,
                    count: contacts.length,
                    contacts: contacts.slice(0, 10)
                });
            });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all contacts
app.get('/api/contacts', (req, res) => {
    res.json({ contacts, total: contacts.length });
});

// Get single contact
app.get('/api/contacts/:id', (req, res) => {
    const contact = contacts.find(c => c.id === parseInt(req.params.id));
    if (contact) {
        res.json(contact);
    } else {
        res.status(404).json({ error: 'Contact not found' });
    }
});

// ============ TWILIO WEBHOOKS ============

// Call status webhook
app.post('/voice/status', (req, res) => {
    const { CallSid, CallStatus } = req.body;
    console.log(`Call ${CallSid} status: ${CallStatus}`);
    res.status(200).send('OK');
});

// Incoming call webhook - Sarah answers
app.post('/voice/incoming', (req, res) => {
    if (!VoiceResponse) {
        console.error('VoiceResponse not initialized');
        return res.status(500).send('Server not configured');
    }

    const twiml = new VoiceResponse();

    // Sarah greets the customer
    twiml.say({
        voice: 'alice',
        language: 'en-US'
    }, `Thank you for calling GT Auto Sales! This is Sarah, and congratulations on your scratch and win prize! Are you interested in scheduling a test drive or visiting our dealership today? Press 1 for yes.`);

    // Wait for button press
    twiml.gather({
        input: 'dtmf',
        action: '/voice/gather',
        method: 'POST',
        numDigits: 1,
        timeout: 30
    });

    res.type('text/xml').send(twiml.toString());
});

// Handle button press - Sarah books appointment
app.post('/voice/gather', async (req, res) => {
    if (!VoiceResponse) {
        return res.status(500).send('Server not configured');
    }
    const { Digits } = req.body;
    const twiml = new VoiceResponse();

    if (Digits === '1') {
        // Customer interested - offer times
        twiml.say({
            voice: 'alice'
        }, `Great! I'd love to help you book your appointment. We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Which time works best for you? Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.`);

        twiml.gather({
            input: 'dtmf',
            action: '/voice/confirm',
            method: 'POST',
            numDigits: 1,
            timeout: 30
        });
    } else {
        // Not interested
        twiml.say({
            voice: 'alice'
        }, `No problem! Feel free to call us back if you change your mind. Have a great day!`);
        twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
});

// Confirm appointment
app.post('/voice/confirm', async (req, res) => {
    if (!VoiceResponse) {
        return res.status(500).send('Server not configured');
    }
    const { Digits, From } = req.body;
    const twiml = new VoiceResponse();

    // Determine time slot
    let timeSlot = '10 AM';
    if (Digits === '2') timeSlot = '2 PM';
    else if (Digits === '3') timeSlot = '4 PM';

    // Create appointment record
    const appointment = {
        id: appointments.length + 1,
        phone: From,
        time: timeSlot,
        date: 'Saturday',
        status: 'confirmed',
        createdAt: new Date().toISOString()
    };
    appointments.push(appointment);

    // Save appointments
    try {
        fs.writeFileSync('data/appointments.json', JSON.stringify(appointments, null, 2));
    } catch (e) {
        console.log('Could not save appointments');
    }

    twiml.say({
        voice: 'alice'
    }, `Perfect! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you! You'll receive a text message with all the details. Thank you for calling GT Auto Sales!`);

    // Send SMS confirmation
    if (From && twilioClient) {
        try {
            await twilioClient.messages.create({
                body: `Hi! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. Claim your scratch & win prize: ${process.env.LANDING_PAGE_URL || 'https://4u95lgtba68e.space.minimax.io'}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: From
            });
        } catch (smsError) {
            console.log('SMS could not be sent:', smsError.message);
        }
    }

    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
});

// ============ APPOINTMENTS ============

app.get('/api/appointments', (req, res) => {
    res.json({ appointments, total: appointments.length });
});

// Start server
app.listen(PORT, () => {
    console.log(`QR AI Voice Server running on port ${PORT}`);
});

export default app;
