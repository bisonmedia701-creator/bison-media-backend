import express from 'express';
import cors from 'cors';
import mul.urlencoded({ extended: true }));

['uploads', 'qrcodes', 'data'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination: ( twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const VoiceResponse = twilio.twiml.VoiceResponse;

const BASE_URL = process.env.BASE_URL || 'https://bison-media-backend.onrender.com';

appl = new VoiceResponse();
    twiml.say({ voice: 'alice' },
        'Thank you for calling GT Auto Sales! This is Sarah, and congratulations on your scratch and win prize! Press 1 if you are interested in scheduling a test drive.');
    twiml.g, res) => {
    const twiml = new VoiceResponse();
    const digit = req.body.Digits;

    if (digit === '1') {
        twiml.say({ voice: 'alice' },
            'Great! We have availability this Saturday at 10 AM,,
            action: `${BASE_URL}/voice/confirm`
        });
    } else {
        twiml.say({ voice: 'alice' }, 'No problem! Have a great day!');
        twiml.hangup();
    }
    res.type('text/xml').send(twdigit === '2') timeSlot = '2 PM';
    else if (digit === '3') timeSlot = '4 PM';

    appointments.push({ phone: from, time: timeSlot, date: 'Saturday', status: 'confirmed' });

    twiml.say({ voice confirmed for ${timeSlot} Saturday! Visit: https://4u95lgtba68e.space.minimax.io`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: from
            });
        } catch (e) { console.log('SMS error:', e.message res.json({ contacts }));

app.listen(PORT, () => console.log('Server running on port', PORT));
