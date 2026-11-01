# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | The engine's Bambu upload over a real local implicit-FTPS server with a real certificate: the bytes arrive, a wrong pin is refused before the access code is sent, a wrong code and a printer without storage are refused by name, and no refusal repeats the code.
"""python3 engine/tests/test_bambu_upload.py (needs the openssl command)"""
import hashlib
import os
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest

ENGINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ENGINE)
from bambu_upload import UploadRefused, upload  # noqa: E402

CODE = "12345678"


class FakePrinter(threading.Thread):
    """One session of the printer's vsftpd conversation over TLS."""

    def __init__(self, context, fail_stor=False):
        super().__init__(daemon=True)
        self.context = context; self.fail_stor = fail_stor; self.received = None; self.password = None; self.commands = []
        self.server = socket.create_server(("127.0.0.1", 0)); self.port = self.server.getsockname()[1]
        self.server.settimeout(10)

    def run(self):
        try:
            raw, _ = self.server.accept()
            control = self.context.wrap_socket(raw, server_side=True)
        except (OSError, ssl.SSLError):
            return
        lines = control.makefile("r"); say = lambda t: control.sendall((t + "\r\n").encode())  # noqa: E731
        say("220 ready")
        for line in lines:
            cmd = line.strip(); verb = cmd.split(" ")[0].upper(); self.commands.append(verb)
            if verb == "USER": say("331 password")
            elif verb == "PASS":
                self.password = cmd.split(" ", 1)[1]
                if self.password != CODE: say("530 no"); return
                say("230 in")
            elif verb in ("PBSZ", "PROT", "TYPE"): say("200 ok")
            elif verb == "PASV":
                data_server = socket.create_server(("127.0.0.1", 0)); p = data_server.getsockname()[1]
                say(f"227 Entering Passive Mode (127,0,0,1,{p >> 8},{p & 255})")
            elif verb == "STOR":
                if self.fail_stor: say("553 no storage"); data_server.close(); continue
                conn, _ = data_server.accept(); say("150 go")
                data = self.context.wrap_socket(conn, server_side=True); chunks = []
                while True:
                    chunk = data.recv(65536)
                    if not chunk: break
                    chunks.append(chunk)
                try: data.unwrap().close()
                except (OSError, ssl.SSLError): data.close()
                self.received = b"".join(chunks); say("226 done")
            elif verb == "QUIT": say("221 bye"); return


class Upload(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory(); cert = os.path.join(cls.dir.name, "c.pem"); key = os.path.join(cls.dir.name, "k.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=01P00A000000000"], check=True, capture_output=True)
        cls.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); cls.context.load_cert_chain(cert, key); cls.context.maximum_version = ssl.TLSVersion.TLSv1_2
        with open(cert) as fh: der = ssl.PEM_cert_to_DER_cert(fh.read())
        digest = hashlib.sha256(der).hexdigest().upper(); cls.pin = ":".join(digest[i:i + 2] for i in range(0, 64, 2))

    @classmethod
    def tearDownClass(cls): cls.dir.cleanup()

    def printer(self, **kw):
        p = FakePrinter(self.context, **kw); p.start(); return p

    def test_the_bytes_arrive(self):
        p = self.printer(); body = os.urandom(300000)
        out = upload("127.0.0.1", p.port, self.pin, CODE, "bench-lift.gcode.3mf", body)
        p.join(10)
        self.assertEqual(out, {"uploaded": True, "fileName": "bench-lift.gcode.3mf", "bytes": 300000}); self.assertEqual(p.received, body)

    def test_a_wrong_pin_is_refused_before_the_code_is_sent(self):
        p = self.printer()
        with self.assertRaisesRegex(UploadRefused, "not the printer pinned"): upload("127.0.0.1", p.port, "AB" * 32, CODE, "x.gcode.3mf", b"x")
        p.join(5); self.assertIsNone(p.password); self.assertNotIn("USER", p.commands)

    def test_a_wrong_code_is_refused_by_name_without_repeating_it(self):
        p = self.printer()
        with self.assertRaises(UploadRefused) as caught: upload("127.0.0.1", p.port, self.pin, "99999999", "x.gcode.3mf", b"x")
        self.assertIn("access code", str(caught.exception)); self.assertNotIn("99999999", str(caught.exception))

    def test_no_storage_is_named(self):
        p = self.printer(fail_stor=True)
        with self.assertRaisesRegex(UploadRefused, "USB stick or SD card"): upload("127.0.0.1", p.port, self.pin, CODE, "x.gcode.3mf", b"x")

    def test_a_path_is_not_a_file_name(self):
        with self.assertRaisesRegex(UploadRefused, "file name"): upload("127.0.0.1", 1, self.pin, CODE, "../x", b"x")


if __name__ == "__main__":
    unittest.main()
