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

// In-memory contact storage (use database in production)
let contacts = [
    {
        id: 1,
        firstName: 'Eric',
        lastName: 'Lorentzen',
        phone: '2535346321',
        email: '',
        source: 'test',
        qrCodeUrl: null,
        createdAt: new Date().toISOString()
    },
    {
        id: 2,
        firstName: 'Frank',
        lastName: 'Colasino',
        phone: '3125764444',
        email: '',
        source: 'test',
        qrCodeUrl: null,
        createdAt: new Date().toISOString()
    },
    {
        id: 3,
        firstName: 'Drew',
        lastName: 'Balogh',
        phone: '2535498860',
        email: '',
        source: 'test',
        qrCodeUrl: null,
        createdAt: new Date().toISOString()
    },
    {
        id: 4,
        firstName: 'Priscilla',
        lastName: 'Watts',
        phone: '2539547398',
        email: '',
        source: 'test',
        qrCodeUrl: null,
        createdAt: new Date().toISOString()
    }
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
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// QR Code call endpoint - Shows browser-based Sarah (no phone call)
app.get('/call/:name', (req, res) => {
    const name = req.params.name;
    // Redirect to the voice.html landing page with name parameter
    // This shows Sarah directly in browser - NO PHONE CALL NEEDED
    res.redirect(`/voice.html?name=${encodeURIComponent(name)}`);
});

// Handle response from QR call
app.post('/call/:name/response', (req, res) => {
    if (!VoiceResponse) {
        return res.status(500).send('Server not configured');
    }

    const twiml = new VoiceResponse();
    const digit = req.body.Digits;
    const name = req.params.name.replace(/-/g, ' ');
    const baseUrl = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';

    if (digit === '1') {
        twiml.say({
            voice: 'alice'
        }, `Great, ${name}! I'd love to help you book your appointment. We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Which time works best for you? Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.`);

        twiml.gather({
            input: 'dtmf',
            numDigits: 1,
            timeout: 30,
            action: `${baseUrl}/call/${req.params.name}/confirm`
        });
    } else {
        twiml.say({
            voice: 'alice'
        }, `No problem, ${name}! We'll call you back at a more convenient time. Have a great day!`);
        twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
});

// Confirm appointment from QR call
app.post('/call/:name/confirm', async (req, res) => {
    if (!VoiceResponse) {
        return res.status(500).send('Server not configured');
    }

    const twiml = new VoiceResponse();
    const digit = req.body.Digits;
    const from = req.body.From;
    const name = req.params.name.replace(/-/g, ' ');

    let timeSlot = '10 AM';
    if (digit === '2') timeSlot = '2 PM';
    else if (digit === '3') timeSlot = '4 PM';

    appointments.push({
        name: name,
        phone: from,
        time: timeSlot,
        date: 'Saturday',
        status: 'confirmed'
    });

    twiml.say({
        voice: 'alice'
    }, `Perfect, ${name}! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you!`);

    if (from) {
        try {
            await twilioClient.messages.create({
                body: `Hi ${name}! Your GT Auto appointment is confirmed for ${timeSlot} Saturday. Can't wait to see you!`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: from
            });
        } catch (e) { console.log('SMS error:', e.message); }
    }

    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
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
                    phone: (row.phone || row.Phone || row.phoneNumber || row['Phone Number'] || '').replace(/\D/g, ''),
                    email: row.email || row.Email || row['Email Address'] || '',
                    source: 'csv',
                    qrCodeUrl: null,
                    createdAt: new Date().toISOString()
                }));

                // Build phone lookup map for Sarah to greet callers by name
                phoneLookup = {};
                contacts.forEach(c => {
                    if (c.phone) {
                        phoneLookup[c.phone] = `${c.firstName} ${c.lastName}`.trim();
                    }
                });

                // Generate QR codes for each contact
                const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

                for (let contact of contacts) {
                    const fullName = `${contact.firstName} ${contact.lastName}`.replace(/\s+/g, '-');
                    const qrCodePath = `qrcodes/${contact.id}_${fullName}.png`;
                    await QRCode.toFile(qrCodePath, `${baseUrl}/call/${fullName}`, {
                        color: { dark: '#000000', light: '#ffffff' },
                        width: 400,
                        margin: 2
                    });
                    contact.qrCodeUrl = `/${qrCodePath}`;
                }

                fs.writeFileSync('data/contacts.json', JSON.stringify(contacts, null, 2));
                fs.writeFileSync('data/phoneLookup.json', JSON.stringify(phoneLookup, null, 2));

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

// Incoming call webhook - Sarah answers and greets by NAME
app.post('/voice/incoming', (req, res) => {
    if (!VoiceResponse) {
        return res.status(500).send('Server not configured');
    }

    const twiml = new VoiceResponse();
    const baseUrl = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';
    const callerPhone = (req.body.From || '').replace(/\D/g, '');

    const callerName = phoneLookup[callerPhone] || 'there';
    const firstName = callerName.split(' ')[0];

    twiml.say({
        voice: 'alice',
        language: 'en-US'
    }, `Hi ${firstName}! This is Sarah from GT Auto Sales. Congratulations on your scratch and win prize! I'm calling to help you schedule your test drive. Is this a good time to talk? Press 1 for yes, or press 2 to schedule a callback.`);

    twiml.gather({
        input: 'dtmf',
        action: `${baseUrl}/voice/gather`,
        method: 'POST',
        numDigits: 1,
        timeout: 30
    });

    res.type('text/xml').send(twiml.toString());
});

// Handle user response after greeting
app.post('/voice/gather', async (req, res) => {
    if (!VoiceResponse) {
        return res.status(500).send('Server not configured');
    }
    const { Digits, From } = req.body;
    const twiml = new VoiceResponse();
    const baseUrl = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';

    const callerPhone = (From || '').replace(/\D/g, '');
    const callerName = phoneLookup[callerPhone] || 'there';
    const firstName = callerName.split(' ')[0];

    if (Digits === '1') {
        twiml.say({
            voice: 'alice'
        }, `Great, ${firstName}! I'd love to help you book your appointment. We have availability this Saturday at 10 AM, 2 PM, or 4 PM. Which time works best for you? Press 1 for 10 AM, press 2 for 2 PM, or press 3 for 4 PM.`);

        twiml.gather({
            input: 'dtmf',
            action: `${baseUrl}/voice/confirm`,
            method: 'POST',
            numDigits: 1,
            timeout: 30
        });
    } else {
        twiml.say({
            voice: 'alice'
        }, `No problem, ${firstName}! Have a great day!`);
        twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
});

// Confirm appointment
app.post('/voice/confirm', async (req, res) => {
    if (!VoiceResponse) {
        return res.status(500).send('Server not configured');
    }
    const { Digits, SpeechResult, From } = req.body;
    const twiml = new VoiceResponse();

    const callerPhone = (From || '').replace(/\D/g, '');
    const callerName = phoneLookup[callerPhone] || 'there';
    const firstName = callerName.split(' ')[0];

    let timeSlot = '10 AM';
    if (Digits === '2') timeSlot = '2 PM';
    else if (Digits === '3') timeSlot = '4 PM';

    const appointment = {
        id: appointments.length + 1,
        name: callerName,
        phone: From,
        time: timeSlot,
        date: 'Saturday',
        status: 'confirmed',
        createdAt: new Date().toISOString()
    };
    appointments.push(appointment);

    try {
        fs.writeFileSync('data/appointments.json', JSON.stringify(appointments, null, 2));
    } catch (e) {}

    twiml.say({
        voice: 'alice'
    }, `Perfect, ${firstName}! Your appointment is confirmed for ${timeSlot} this Saturday at GT Auto Sales. We look forward to seeing you! You'll receive a text message with all the details.`);

    if (From) {
        try {
            await twilioClient.messages.create({
                body: `Hi ${firstName}! Your GT Auto appointment is confirmed for ${timeSlot} Saturday. Can't wait to see you!`,
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

// ============ BROWSER-BASED SARAH (No Phone Call) ============

// Chat with Sarah AI (browser-based)
app.post('/api/sarah/chat', async (req, res) => {
    const { message, customerName, history } = req.body;
    const firstName = customerName?.split(' ')[0] || 'there';

    try {
        let prompt = `You are Sarah, a friendly and professional AI assistant for GT Auto Sales car dealership.
IMPORTANT: You MUST greet the customer by name: "${firstName}"
Your personality: warm, helpful, conversational, and professional.
Your job:
1. Greet the customer by name (${firstName})
2. Explain they're at a scratch and win event
3. Help them book a test drive appointment
4. Be friendly and natural
Event details:
- GT Auto Sales
- Special scratch and win prizes
- 0% APR financing available
- Saturday appointments at 10 AM, 2 PM, or 4 PM
- Phone: (888) 308-9827
Keep responses concise (1-2 sentences) and natural.`;

        if (history && history.length > 0) {
            prompt += `\n\nConversation history:\n` + history.map(h => `${h.role}: ${h.content}`).join('\n');
        }
        prompt += `\n\nCustomer says: ${message}`;

        let response;
        if (openai) {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4',
                messages: [{ role: 'system', content: prompt }],
                max_tokens: 150
            });
            response = completion.choices[0].message.content;
        } else {
            const msg = message.toLowerCase();
            if (msg.includes('yes') || msg.includes('book') || msg.includes('schedule') || msg.includes('appointment')) {
                response = `Great, ${firstName}! I can help you book a test drive. Would you prefer 10 AM, 2 PM, or 4 PM this Saturday?`;
            } else if (msg.includes('10') || msg.includes('morning')) {
                response = `Perfect! I've reserved 10 AM for you this Saturday. Should I confirm your appointment?`;
            } else if (msg.includes('2') || msg.includes('afternoon')) {
                response = `Excellent choice! 2 PM works great. Shall I confirm your appointment?`;
            } else if (msg.includes('4') || msg.includes('evening')) {
                response = `Wonderful! 4 PM it is. Would you like me to confirm your appointment?`;
            } else if (msg.includes('confirm') || msg.includes('yes confirm')) {
                response = '__CONFIRM_APPOINTMENT__';
            } else if (msg.includes('no') || msg.includes('not') || msg.includes('maybe')) {
                response = `No problem, ${firstName}! Feel free to visit us anytime this weekend or call (888) 308-9827. Have a great day!`;
            } else {
                response = `I understand, ${firstName}. Would you like to schedule a test drive this Saturday? We have availability at 10 AM, 2 PM, or 4 PM.`;
            }
        }

        const showAppointmentForm = response.includes('10 AM') || response.includes('2 PM') || response.includes('4 PM');
        res.json({ response, showAppointmentForm });
    } catch (error) {
        console.error('Sarah chat error:', error);
        res.json({ response: `I'm sorry, I encountered an error. Would you like to schedule an appointment by calling (888) 308-9827?`, showAppointmentForm: false });
    }
});

// Book appointment from browser
app.post('/api/appointments/book', async (req, res) => {
    const { customerName, time, date, phone } = req.body;

    const appointment = {
        id: appointments.length + 1,
        name: customerName,
        phone: phone || '',
        time: time,
        date: date,
        status: 'confirmed',
        source: 'browser',
        createdAt: new Date().toISOString()
    };
    appointments.push(appointment);

    try {
        fs.writeFileSync('data/appointments.json', JSON.stringify(appointments, null, 2));
    } catch (e) {}

    res.json({ success: true, appointmentId: appointment.id });
});

// ============ APPOINTMENTS ============

app.get('/api/appointments', (req, res) => {
    res.json({ appointments, total: appointments.length });
});

// ============ LANDING PAGE DATA ============

app.get('/api/config/landing', (req, res) => {
    res.json({
        dealershipName: process.env.DEALERSHIP_NAME || 'GT Auto Sales',
        logo: process.env.DEALERSHIP_LOGO || null,
        primaryColor: process.env.PRIMARY_COLOR || '#1a56db',
        offers: [
            { title: '0% APR Financing', description: 'On select models for qualified buyers' },
            { title: 'Trade-In Bonus', description: 'Up to \$2,000 extra for your trade-in' },
            { title: 'Extended Warranty', description: 'Free 5-year powertrain warranty' }
        ]
    });
});

app.post('/api/config/landing', (req, res) => {
    res.json({ success: true, config: req.body });
});

// ============ QR CODE GENERATION ============

async function initQRCodes() {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

    if (!fs.existsSync('qrcodes')) {
        fs.mkdirSync('qrcodes', { recursive: true });
    }

    for (const contact of contacts) {
        const fullName = `${contact.firstName}-${contact.lastName}`;
        const qrCodePath = `qrcodes/${fullName}.png`;
        const qrUrl = `${baseUrl}/call/${fullName}`;

        try {
            await QRCode.toFile(qrCodePath, qrUrl, {
                color: { dark: '#000000', light: '#ffffff' },
                width: 400,
                margin: 2
            });
            console.log(`QR code generated for ${contact.firstName} ${contact.lastName}`);
        } catch (e) {
            console.log(`QR generation skipped for ${contact.firstName}:`, e.message);
        }
    }
}

// Start server
app.listen(PORT, async () => {
    console.log(`QR AI Voice Server running on port ${PORT}`);
    console.log(`Sarah greets callers by NAME from contacts`);
    console.log(`Test contacts: Eric, Frank, Drew, Priscilla`);
    console.log(`Browser-based Sarah: /call/Name redirects to voice.html`);
    console.log(`Test URLs:`);
    contacts.forEach(c => {
        console.log(`   ${process.env.BASE_URL || 'https://bison-media-backend.onrender.com'}/call/${c.firstName}-${c.lastName}`);
    });
    await initQRCodes();
});

export default app;
