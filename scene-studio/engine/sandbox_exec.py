#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ                 | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation -- the launcher every
#   |                                           | Scene Studio job runs through: resource limits
#   |                                           | the job cannot raise, then a seccomp filter the
#   |                                           | job cannot remove (AF_UNIX sockets only, so no IP
#   |                                           | networking to the stack or the internet; io_uring,
#   |                                           | ptrace, cross-process memory and pidfd_getfd
#   |                                           | refused; a foreign-ABI system call kills the job),
#   |                                           | then exec. A launcher that cannot install the
#   |                                           | filter refuses to run the job at all.
"""sandbox_exec -- run one Scene Studio job under the engine's sandbox (stdlib only).

Usage: sandbox_exec.py [--cpu-seconds N] [--file-mb N] [--open-files N] -- PROGRAM [ARGS...]

A job is code a person, or their concierge, wrote: GDScript that a Godot project runs, Python that
Blender executes. The engine container already runs read-only, with every capability dropped,
no-new-privileges, a pids limit and a memory limit. On top of that, every job:

1. gets resource limits it cannot raise: no core files, a CPU-time budget, a largest-file size and
   an open-file count;
2. gets a seccomp filter it cannot remove (the kernel keeps it across fork and exec):
   - socket() is allowed for AF_UNIX only, so the job has no IP networking at all: not to postgres,
     redis or the api on the stack network, and not to the internet;
   - io_uring (which can open sockets without calling socket()), ptrace, process_vm_readv/writev and
     pidfd_getfd are refused, so a job cannot borrow another process's sockets or memory;
   - a system call from a foreign ABI (i386 or x32 on x86_64, AArch32 on arm64) kills the job, so
     the syscall-number checks above cannot be sidestepped;
3. then execs PROGRAM with the environment it was given.
"""
import ctypes
import errno
import os
import platform
import resource
import sys

PR_SET_NO_NEW_PRIVS = 38
PR_SET_SECCOMP = 22
SECCOMP_MODE_FILTER = 2
SECCOMP_RET_KILL_PROCESS = 0x80000000
SECCOMP_RET_ERRNO = 0x00050000
SECCOMP_RET_ALLOW = 0x7FFF0000
AF_UNIX = 1
X32_SYSCALL_BIT = 0x40000000

# Classic BPF opcodes (linux/bpf_common.h).
BPF_LD_W_ABS = 0x20  # BPF_LD | BPF_W | BPF_ABS
BPF_JEQ_K = 0x15     # BPF_JMP | BPF_JEQ | BPF_K
BPF_JGE_K = 0x35     # BPF_JMP | BPF_JGE | BPF_K
BPF_RET_K = 0x06     # BPF_RET | BPF_K

# struct seccomp_data: int nr; __u32 arch; __u64 instruction_pointer; __u64 args[6].
# args[0] is read as its low 32 bits, which is the whole of socket()'s int domain on little-endian.
OFF_NR = 0
OFF_ARCH = 4
OFF_ARG0 = 16

#: The syscall numbers the filter names, per machine. arm64 uses the generic table
#: (include/uapi/asm-generic/unistd.h); x86_64 its own (arch/x86/entry/syscalls/syscall_64.tbl).
ARCHES = {
    "aarch64": {
        "audit_arch": 0xC00000B7,
        "x32": False,
        "nr": {"socket": 198, "ptrace": 117, "process_vm_readv": 270, "process_vm_writev": 271,
               "io_uring_setup": 425, "io_uring_enter": 426, "io_uring_register": 427, "pidfd_getfd": 438},
    },
    "x86_64": {
        "audit_arch": 0xC000003E,
        "x32": True,
        "nr": {"socket": 41, "ptrace": 101, "process_vm_readv": 310, "process_vm_writev": 311,
               "io_uring_setup": 425, "io_uring_enter": 426, "io_uring_register": 427, "pidfd_getfd": 438},
    },
}
REFUSED = ("io_uring_setup", "io_uring_enter", "io_uring_register", "ptrace",
           "process_vm_readv", "process_vm_writev", "pidfd_getfd")
DEFAULTS = {"cpu_seconds": 600, "file_mb": 256, "open_files": 1024}
REFUSE_EXIT = 126


class SandboxError(Exception):
    """The sandbox could not be put in place; the job must not run."""


def build_filter(machine):
    """@description Assemble the seccomp program for one machine.
    @param machine platform.machine() of the box.
    @returns List of (code, jt, jf, k) instructions with jumps resolved."""
    spec = ARCHES.get(machine)
    if spec is None:
        raise SandboxError(f"no seccomp syscall table for machine {machine!r}")
    nr = spec["nr"]
    prog = []
    labels = {}

    def emit(code, k=0, jt=0, jf=0):
        prog.append((code, jt, jf, k))

    def label(name):
        labels[name] = len(prog)

    emit(BPF_LD_W_ABS, OFF_ARCH)
    emit(BPF_JEQ_K, spec["audit_arch"], jt=0, jf="kill")
    emit(BPF_LD_W_ABS, OFF_NR)
    if spec["x32"]:
        emit(BPF_JGE_K, X32_SYSCALL_BIT, jt="kill", jf=0)
    emit(BPF_JEQ_K, nr["socket"], jt="socket", jf=0)
    for name in REFUSED:
        emit(BPF_JEQ_K, nr[name], jt="eperm", jf=0)
    emit(BPF_RET_K, SECCOMP_RET_ALLOW)
    label("socket")
    emit(BPF_LD_W_ABS, OFF_ARG0)
    emit(BPF_JEQ_K, AF_UNIX, jt="allow", jf="eacces")
    label("allow")
    emit(BPF_RET_K, SECCOMP_RET_ALLOW)
    label("eacces")
    emit(BPF_RET_K, SECCOMP_RET_ERRNO | errno.EACCES)
    label("eperm")
    emit(BPF_RET_K, SECCOMP_RET_ERRNO | errno.EPERM)
    label("kill")
    emit(BPF_RET_K, SECCOMP_RET_KILL_PROCESS)

    resolved = []
    for index, (code, jt, jf, k) in enumerate(prog):
        resolved.append((code, _offset(labels, index, jt), _offset(labels, index, jf), k))
    return resolved


def _offset(labels, index, target):
    """A jump target is an offset from the NEXT instruction; labels resolve to one."""
    if not isinstance(target, str):
        return target
    offset = labels[target] - (index + 1)
    if not 0 <= offset <= 255:
        raise SandboxError(f"seccomp jump to {target} out of range ({offset})")
    return offset


class _SockFilter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte), ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint32)]


class _SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.POINTER(_SockFilter))]


def install_filter(program):
    """@description Set no-new-privs and load the program; irreversible for this process and its children.
    @param program Instructions from build_filter. @throws SandboxError when the kernel refuses."""
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise SandboxError(f"PR_SET_NO_NEW_PRIVS failed: {os.strerror(ctypes.get_errno())}")
    array = (_SockFilter * len(program))(*[_SockFilter(c, jt, jf, k) for (c, jt, jf, k) in program])
    fprog = _SockFprog(len(program), ctypes.cast(array, ctypes.POINTER(_SockFilter)))
    if libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.addressof(fprog), 0, 0) != 0:
        raise SandboxError(f"seccomp filter refused: {os.strerror(ctypes.get_errno())}")


def apply_limits(cpu_seconds, file_mb, open_files):
    """@description Lower the job's resource limits (soft == hard, so the job cannot raise them).
    CPU time is counted across every thread, so a multi-threaded render spends it faster than the
    wall clock; the bridge's wall-clock timeout is the primary bound."""
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    file_bytes = file_mb * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_FSIZE, (file_bytes, file_bytes))
    _, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    cap = open_files if hard == resource.RLIM_INFINITY else min(open_files, hard)
    resource.setrlimit(resource.RLIMIT_NOFILE, (cap, cap))


def parse_args(argv):
    """@description Split `[--opt N]... -- PROGRAM ARGS`; options are positive integers.
    @returns (options dict, program argv). @throws SandboxError on a malformed line."""
    opts = dict(DEFAULTS)
    names = {"--cpu-seconds": "cpu_seconds", "--file-mb": "file_mb", "--open-files": "open_files"}
    i = 0
    while i < len(argv) and argv[i] != "--":
        key = names.get(argv[i])
        if key is None or i + 1 >= len(argv):
            raise SandboxError(f"unknown or incomplete option {argv[i]!r}")
        try:
            value = int(argv[i + 1])
        except ValueError as exc:
            raise SandboxError(f"{argv[i]} needs an integer") from exc
        if value <= 0:
            raise SandboxError(f"{argv[i]} must be positive")
        opts[key] = value
        i += 2
    program = argv[i + 1:]
    if i >= len(argv) or not program:
        raise SandboxError("usage: sandbox_exec.py [--cpu-seconds N] [--file-mb N] [--open-files N] -- PROGRAM [ARGS...]")
    return opts, program


def main(argv):
    """@description Limits, filter, exec -- or refuse with exit 126 and a reason on stderr."""
    try:
        opts, program = parse_args(argv)
        apply_limits(opts["cpu_seconds"], opts["file_mb"], opts["open_files"])
        install_filter(build_filter(platform.machine()))
    except (SandboxError, OSError, ValueError) as exc:
        sys.stderr.write(f"[sandbox_exec] refusing to run the job unsandboxed: {exc}\n")
        return REFUSE_EXIT
    try:
        os.execvp(program[0], program)
    except OSError as exc:
        sys.stderr.write(f"[sandbox_exec] cannot exec {program[0]!r}: {exc}\n")
        return REFUSE_EXIT
    return REFUSE_EXIT  # unreachable: execvp only returns by raising


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
