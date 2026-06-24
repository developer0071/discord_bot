const FormData = require('form-data');
const fs = require('fs');
const fetch = require('node-fetch'); // we'll use standard http if node-fetch is not available
const http = require('http');

const boundary = '--------------------------123456789012345678901234';
const payload = `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="channelId"\r\n\r\n` +
  `12345\r\n` +
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="content"\r\n\r\n` +
  `hello world\r\n` +
  `--${boundary}--\r\n`;

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/chat/send',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(payload);
req.end();
