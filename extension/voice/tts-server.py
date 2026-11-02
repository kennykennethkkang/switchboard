# Kokoro TTS on 127.0.0.1. POST /tts {"text", "voice"?, "speed"?} -> audio/wav
import io
import json
import os
import sys
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from kokoro_onnx import Kokoro

MODELS = os.path.expanduser('~/.claude/switchboard/voice/models')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8179

kokoro = Kokoro(f'{MODELS}/kokoro-v1.0.onnx', f'{MODELS}/voices-v1.0.bin')


def to_wav(samples, rate):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

    def do_POST(self):
        if self.path != '/tts':
            return self.send_error(404)
        # A web page can POST text/plain here without a preflight; JSON it cannot.
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self.send_error(415, 'application/json only')
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            text = str(body.get('text', '')).strip()[:5000]
            if not text:
                return self.send_error(400, 'text required')
            samples, rate = kokoro.create(text, voice=body.get('voice', 'af_heart'),
                                          speed=float(body.get('speed', 1.0)), lang='en-us')
        except Exception as e:
            return self.send_error(400, str(e)[:200])
        data = to_wav(samples, rate)
        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
