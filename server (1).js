/**
 * Bison Media Voice Agent - Backend Server
 * Full Twilio + OpenAI + Supabase Integration
 */

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

// Load environment variables
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// ============================================
// CONFIGURATION
// ============================================

// Twilio Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'AC30027cf37865e8927268db38ea42555b';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'b40a37dd39f7ba18ec61ba78f4d25972';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+18883089827';

// Initialize Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Supabase Configuration
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xyszyxibdvlxfhjddzlh.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5c3p5eGliZHZseGZoZGR6bGgiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY5MjU1MTYwMCwiZXhwIjoxNzI0MTI3NjAwfQ.W94SyZO9UDpn3ek0IY6PFg_bgV8pfBx'
);

// ============================================
// DATABASE FUNCTIONS
// ============================================

async function getCustomerByQrCode(qrCodeId) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('qr_code_id', qrCodeId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

async function getCustomerByPhone(phone) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

async function updateCustomerAppointment(customerId, appointmentDate, appointmentTime) {
  const { data, error } = await supabase
    .from('leads')
    .update({
      appointment_scheduled: true,
      appointment_date: `${appointmentDate} ${appointmentTime}`,
      call_status: 'answered',
      updated_at: new Date().toISOString()
    })
    .eq('id', customerId)
    .select()
    .single();

  if (error) {
    console.error('Error updating appointment:', error);
    return null;
  }

  return data;
}

async function updateCallStatus(customerId, status, attempts = null) {
  const updates = {
    call_status: status,
    updated_at: new Date().toISOString()
  };

  if (attempts !== null) {
    updates.call_attempts = attempts;
  }

  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', customerId)
    .select()
    .single();

  if (error) {
    console.error('Error updating call status:', error);
    return null;
  }

  return data;
}

async function logCall(customerId, callSid, status, duration) {
  const { data, error } = await supabase
    .from('call_logs')
    .insert({
      lead_id: customerId,
      call_sid: callSid,
      call_status: status,
      duration: duration,
      created_at: new Date().toISOString()
    });

  if (error) {
    console.error('Error logging call:', error);
  }

  return data;
}

// ============================================
// TWILIO VOICE CALL FUNCTIONS
// ============================================

async function makeOutboundCall(customerId, customerPhone, qrCodeId) {
  const baseUrl = process.env.BASE_URL || 'https://your-server.com';

  try {
    const call = await twilioClient.calls.create({
      to: customerPhone,
      from: TWILIO_PHONE_NUMBER,
      url: `${baseUrl}/voice/outbound?customerId=${customerId}&qrCodeId=${qrCodeId}`,
      statusCallback: `${baseUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'no-answer', 'busy', 'failed'],
      statusCallbackMethod: 'POST'
    });

    console.log(`Call initiated: ${call.sid} to ${customerPhone}`);
    return { success: true, callSid: call.sid, status: call.status };
  } catch (error) {
    console.error('Error making call:', error);
    return { success: false, error: error.message };
  }
}

async function sendSMS(to, message) {
  try {
    const sms = await twilioClient.messages.create({
      to: to,
      from: TWILIO_PHONE_NUMBER,
      body: message
    });

    console.log(`SMS sent: ${sms.sid} to ${to}`);
    return { success: true, messageSid: sms.sid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// TWILIO WEBHOOK ENDPOINTS
// ============================================

app.post('/voice/outbound', async (req, res) => {
  const { customerId, qrCodeId } = req.query;

  let customer = null;
  if (customerId) {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('id', customerId)
      .single();
    customer = data;
  }

  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'there';

  res.set('Content-Type', 'text/xml');
  res.send(`
    <Response>
      <Say voice="Polly.Joanna" bargeIn="true">
        Hello ${customerName}! This is Sarah from Bison Media Auto Sales.
      </Say>
      <Pause length="1"/>
      <Say voice="Polly.Joanna">
        We're calling because you expressed interest in our exclusive vehicle offers.
        We have a special promotion just for you that includes a great discount on your next vehicle purchase.
      </Say>
      <Pause length="1"/>
      <Say voice="Polly.Joanna">
        To learn more and schedule a personalized test drive, please visit our mobile booking page.
        You can also book an appointment right now by speaking with our representative.
      </Say>
      <Pause length="1"/>
      <Say voice="Polly.Joanna">
        Would you like to schedule a test drive appointment? Please say yes to speak with our team, or no to opt out.
      </Say>
      <Gather numDigits="1" action="/voice/gather-response?customerId=${customerId || ''}" method="POST">
        <Say voice="Polly.Joanna">
          Press 1 for yes and to schedule an appointment.
          Press 2 for no thank you.
        </Say>
      </Gather>
      <Say voice="Polly.Joanna">
        I didn't receive a response. Thank you for your time. Goodbye!
      </Say>
      <Hangup/>
    </Response>
  `);
});

app.post('/voice/gather-response', async (req, res) => {
  const { Digits, customerId } = req.body;

  if (Digits === '1') {
    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        <Say voice="Polly.Joanna">
          Great! Our team will contact you shortly to schedule your appointment.
        </Say>
        <Pause length="1"/>
        <Say voice="Polly.Joanna">
          In the meantime, you can book online right now by scanning the QR code on your mail piece,
          or visiting our website and entering your code.
        </Say>
        <Pause length="1"/>
        <Say voice="Polly.Joanna">
          Thank you for your interest in Bison Media Auto Sales. Have a great day!
        </Say>
        <Hangup/>
      </Response>
    `);

    if (customerId) {
      await updateCallStatus(customerId, 'interested');
    }
  } else if (Digits === '2') {
    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        <Say voice="Polly.Joanna">
          No problem! Thank you for your time. You will not receive any further calls from us.
          Have a great day!
        </Say>
        <Hangup/>
      </Response>
    `);

    if (customerId) {
      await updateCallStatus(customerId, 'opt_out');
    }
  } else {
    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        <Say voice="Polly.Joanna">
          I didn't understand your choice. Please try again.
        </Say>
        <Redirect method="POST">/voice/gather-response</Redirect>
      </Response>
    `);
  }
});

app.post('/voice/incoming', async (req, res) => {
  const from = req.body.From;

  res.set('Content-Type', 'text/xml');
  res.send(`
    <Response>
      <Say voice="Polly.Joanna">
        Thank you for calling Bison Media Auto Sales. Your call is important to us.
      </Say>
      <Pause length="1"/>
      <Say voice="Polly.Joanna">
        If you're calling about an appointment or have questions about our vehicles,
        please stay on the line and our team will assist you shortly.
      </Say>
      <Dial timeout="60" record="record-from-ringing">
        <Number>+15551234567</Number>
      </Dial>
      <Say voice="Polly.Joanna">
        All our representatives are currently unavailable. Please leave a message and we will call you back.
      </Say>
      <Record action="/voice/voicemail" method="POST" maxLength="60" finishOnKey="#" />
      <Say voice="Polly.Joanna">
        We received your message. Thank you for calling Bison Media Auto Sales!
      </Say>
      <Hangup/>
    </Response>
  `);
});

app.post('/voice/status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration, From, To } = req.body;

  console.log(`Call status: ${CallSid} - ${CallStatus} (Duration: ${CallDuration}s)`);

  res.sendStatus(200);
});

app.post('/voice/voicemail', async (req, res) => {
  const { RecordingUrl, From, To } = req.body;

  console.log(`Voicemail from ${From}: ${RecordingUrl}`);

  res.set('Content-Type', 'text/xml');
  res.send(`
    <Response>
      <Say voice="Polly.Joanna">
        Thank you for your message. We will return your call within 24 hours.
      </Say>
      <Hangup/>
    </Response>
  `);
});

// ============================================
// REST API ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    twilio: {
      configured: !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN),
      phoneNumber: TWILIO_PHONE_NUMBER
    }
  });
});

app.get('/api/customer/:qrCodeId', async (req, res) => {
  const { qrCodeId } = req.params;
  const customer = await getCustomerByQrCode(qrCodeId);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json(customer);
});

app.post('/api/call', async (req, res) => {
  const { customerId, phone, qrCodeId } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const result = await makeOutboundCall(customerId, phone, qrCodeId);

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  if (customerId) {
    const customer = await supabase
      .from('leads')
      .select('call_attempts')
      .eq('id', customerId)
      .single();

    if (customer.data) {
      await supabase
        .from('leads')
        .update({ call_attempts: (customer.data.call_attempts || 0) + 1 })
        .eq('id', customerId);
    }
  }

  res.json({ success: true, callSid: result.callSid });
});

app.post('/api/sms', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Phone number and message are required' });
  }

  const result = await sendSMS(to, message);

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ success: true, messageSid: result.messageSid });
});

app.post('/api/book-appointment', async (req, res) => {
  const { customerId, date, time } = req.body;

  if (!customerId || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const appointment = await updateCustomerAppointment(customerId, date, time);

  if (!appointment) {
    return res.status(500).json({ error: 'Failed to book appointment' });
  }

  if (appointment.phone) {
    await sendSMS(
      appointment.phone,
      `Appointment Confirmed! ${appointment.first_name}, your test drive is scheduled for ${date} at ${time}. See you at Bison Media Auto Sales!`
    );
  }

  res.json({ success: true, appointment });
});

app.post('/api/leads', async (req, res) => {
  const { firstName, lastName, email, phone, qrCodeId } = req.body;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and last name are required' });
  }

  const finalQrCodeId = qrCodeId || `${firstName.toUpperCase()}-${lastName.toUpperCase()}-${Date.now()}`;

  const { data, error } = await supabase
    .from('leads')
    .insert({
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      phone: phone || null,
      qr_code_id: finalQrCodeId,
      source: 'booking_page',
      call_status: 'pending',
      call_attempts: 0,
      appointment_scheduled: false
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating lead:', error);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  res.json({ success: true, lead: data });
});

app.get('/api/leads', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch leads' });
  }

  res.json({ leads: data });
});

app.put('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to update lead' });
  }

  res.json({ success: true, lead: data });
});

app.delete('/api/leads/:id', async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: 'Failed to delete lead' });
  }

  res.json({ success: true });
});

app.post('/api/leads/bulk', async (req, res) => {
  const { leads } = req.body;

  if (!leads || !Array.isArray(leads)) {
    return res.status(400).json({ error: 'Invalid leads data' });
  }

  const formattedLeads = leads.map((lead, index) => ({
    first_name: lead.firstName || lead.first_name || lead.name?.split(' ')[0] || '',
    last_name: lead.lastName || lead.last_name || lead.name?.split(' ').slice(1).join(' ') || '',
    email: lead.email || null,
    phone: lead.phone || null,
    qr_code_id: lead.qrCodeId || lead.qr_code_id || `${lead.first_name?.toUpperCase()}-${lead.last_name?.toUpperCase()}-${Date.now() + index}`,
    source: 'bulk_import',
    call_status: 'pending',
    call_attempts: 0,
    appointment_scheduled: false
  }));

  const { data, error } = await supabase
    .from('leads')
    .insert(formattedLeads)
    .select();

  if (error) {
    console.error('Error bulk importing leads:', error);
    return res.status(500).json({ error: 'Failed to import leads' });
  }

  res.json({ success: true, imported: data.length, leads: data });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           BISON MEDIA VOICE AGENT - BACKEND               ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                              ║
║                                                           ║
║  Twilio Configuration:                                    ║
║  - Phone: ${TWILIO_PHONE_NUMBER}                           ║
║  - SID: ${TWILIO_ACCOUNT_SID.substring(0, 20)}...           ║
║                                                           ║
║  Webhook Endpoints:                                       ║
║  - POST /voice/outbound  - Outbound call TwiML             ║
║  - POST /voice/gather-response - Handle keypad input      ║
║  - POST /voice/incoming  - Incoming call handler          ║
║  - POST /voice/status    - Call status callback           ║
║  - POST /voice/voicemail - Voicemail handler              ║
║                                                           ║
║  REST API:                                                ║
║  - GET  /api/health       - Health check                  ║
║  - GET  /api/customer/:id - Get customer by QR code      ║
║  - POST /api/call         - Initiate outbound call       ║
║  - POST /api/sms          - Send SMS                      ║
║  - POST /api/book-appointment - Book appointment          ║
║  - GET  /api/leads        - Get all leads                 ║
║  - POST /api/leads        - Create lead                   ║
║  - PUT  /api/leads/:id    - Update lead                   ║
║  - DELETE /api/leads/:id  - Delete lead                   ║
║  - POST /api/leads/bulk   - Bulk import leads             ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
