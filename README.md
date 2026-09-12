# AURA FF Support — Render deployment

## Files
- `server.js` — backend + player lookup proxy
- `public/index.html` — website
- `public/payment-qr.jpg` — supplied UPI QR
- `package.json`

## Render
Create a Web Service and connect this project.
Build Command: `npm install`
Start Command: `npm start`

Add Environment Variable:
- Name: `FF_API_KEY`
- Value: your API key from Free Fire API Hub

Do not put the API key inside `index.html`.

## Payment
Configured UPI ID: `jinwoo40054@ptaxis`
Configured amount: ₹500

The site does NOT automatically claim payment verification. For production, add a legitimate payment gateway/webhook if you need automatic verification.
