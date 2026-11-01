"""bambu_upload -- send one sliced archive to a Bambu Lab printer over its LAN FTPS (stdlib only).

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR | DESCRIPTION
-----------------------------------------------------------------------------
1 | maintainer@emeraldcoastsystemsgroup.com | A native package has no network, so the upload runs here in the engine container, which can reach the LAN. The same rules as the package's TypeScript client: TLS 1.2 at most, the peer's certificate must match the fingerprint pinned at registration BEFORE the access code is sent, the data channel resumes the control session (the printer's vsftpd requires it). It never starts a print.
"""
import ftplib
import hashlib
import socket
import ssl

TIMEOUT_S = 40
SAFE_NAME = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")


class UploadRefused(ValueError):
    """A refusal whose message is safe to show: it never carries the access code."""


def normal_fingerprint(value):
    """@description The fingerprint as upper-case hex without separators. @param value Node's AA:BB form or plain hex. @returns The normal form."""
    return str(value or "").replace(":", "").strip().upper()


def _context():
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE  # the pin below is the identity check: these printers present a self-signed certificate
    context.maximum_version = ssl.TLSVersion.TLSv1_2
    return context


class _PinnedFtps(ftplib.FTP_TLS):
    """Implicit FTPS whose data channel resumes the control session."""

    def __init__(self, pin, context):
        super().__init__(context=context)
        self.pin = pin

    def connect(self, host="", port=0, timeout=-999, source_address=None):
        self.host, self.port = host, port
        self.timeout = timeout
        raw = socket.create_connection((host, port), timeout)
        self.sock = self.context.wrap_socket(raw)
        seen = hashlib.sha256(self.sock.getpeercert(True)).hexdigest().upper()
        if seen != self.pin:
            self.sock.close()
            raise UploadRefused(f"the device at {host} is not the printer pinned at registration; remove and add it again")
        self.af = self.sock.family
        self.file = self.sock.makefile("r", encoding=self.encoding)
        self.welcome = self.getresp()
        return self.welcome

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        return self.context.wrap_socket(conn, session=self.sock.session), size


def upload(host, port, cert_sha256, access_code, file_name, data):
    """@description Upload one archive to the printer's storage.
    @param host Printer LAN address. @param port FTPS port (990). @param cert_sha256 Fingerprint pinned at registration.
    @param access_code LAN access code. @param file_name Safe file name. @param data Archive bytes.
    @returns {"uploaded": True, "fileName", "bytes"}. Raises UploadRefused with a message safe to show."""
    pin = normal_fingerprint(cert_sha256)
    if len(pin) != 64:
        raise UploadRefused("this printer has no pinned certificate; remove and add it again")
    if not file_name or set(file_name) - SAFE_NAME or file_name.startswith("."):
        raise UploadRefused("the file name is not one the printer accepts")
    ftp = _PinnedFtps(pin, _context())
    try:
        try:
            ftp.connect(host, port, TIMEOUT_S)
            ftp.login("bblp", access_code, secure=False)
            ftp.prot_p()
            ftp.voidcmd("TYPE I")
            conn, _ = ftp.ntransfercmd(f"STOR {file_name}")
            try:
                conn.sendall(data)
                try:
                    conn.unwrap().close()
                except (OSError, ValueError):
                    conn.close()
            except OSError:
                conn.close()
                raise
            ftp.voidresp()
        except ftplib.error_perm as exc:
            code = str(exc)[:3]
            if code == "530":
                raise UploadRefused("the printer refused the access code; check it on the printer's screen") from None
            if code == "553":
                raise UploadRefused("the printer has no storage to write to; insert its USB stick or SD card") from None
            raise UploadRefused(f"the printer refused the upload ({code})") from None
        except ftplib.all_errors as exc:
            if isinstance(exc, UploadRefused):
                raise
            raise UploadRefused(f"the printer at {host} could not be reached from the engine ({type(exc).__name__}: {exc})") from None
    finally:
        try:
            ftp.close()
        except OSError:
            pass
    return {"uploaded": True, "fileName": file_name, "bytes": len(data)}
