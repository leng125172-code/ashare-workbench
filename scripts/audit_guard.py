#!/usr/bin/env python3
"""Linux-only, fail-closed supervisor for CC's local Node audits, not a daemon."""
import argparse, fcntl, hashlib, json, os, pathlib, selectors, shutil, signal, subprocess, sys, tempfile, time


def unit_for(script):
    return 'cc-audit-' + hashlib.sha256(str(script).encode()).hexdigest()[:24] + '.service'


def ctl(*args):
    return subprocess.run(['systemctl', '--user', *args], capture_output=True, text=True, timeout=4)


def worker(a):
    # Verify actual kernel controls before executing any audit code.
    script = pathlib.Path(a.script).resolve(strict=True)
    line = next(x for x in pathlib.Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'))
    cg = pathlib.Path('/sys/fs/cgroup') / line[3:].lstrip('/')
    expected = {'memory.max': str(a.memory_mib * 1048576), 'memory.swap.max': '0',
                'memory.oom.group': '1', 'pids.max': '32'}
    if cg.name != unit_for(script) or any((cg / k).read_text().strip() != v for k, v in expected.items()):
        raise RuntimeError('CGROUP_GUARD_NOT_EFFECTIVE')
    ready = pathlib.Path(a.ready)
    data = {'nonce': a.nonce, 'invocation': os.environ.get('INVOCATION_ID'), 'cgroup': str(cg), 'limits': expected}
    if not data['invocation']:
        raise RuntimeError('INVOCATION_ID_MISSING')
    fd = os.open(str(ready) + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f)
    os.replace(str(ready) + '.tmp', ready)
    os.environ['CC_AUDIT_GUARDED'] = '1'
    os.execv(a.node, [a.node, '--max-old-space-size=' + str(a.heap_mib), str(script), *a.args])


def supervise(a):
    script = pathlib.Path(a.script).resolve(strict=True)
    if script.suffix not in ('.js', '.cjs', '.mjs') or not script.is_file():
        raise ValueError('AUDIT_SCRIPT_REQUIRED')
    if not 64 <= a.memory_mib <= 512 or not 16 <= a.heap_mib <= min(128, a.memory_mib // 2):
        raise ValueError('MEMORY_LIMIT_INVALID')
    if not 1 <= a.seconds <= 120 or not 1024 <= a.output_bytes <= 1048576:
        raise ValueError('TIME_OR_OUTPUT_LIMIT_INVALID')
    node = shutil.which(a.node)
    if not node or not shutil.which('systemd-run') or not shutil.which('systemctl'):
        raise RuntimeError('GUARD_DEPENDENCY_UNAVAILABLE')
    if not pathlib.Path('/sys/fs/cgroup/cgroup.controllers').exists():
        raise RuntimeError('CGROUP_V2_REQUIRED')
    runtime = pathlib.Path('/run/user') / str(os.getuid()) / 'cc-audit-guard'
    runtime.mkdir(mode=0o700, exist_ok=True)
    st = runtime.lstat()
    if runtime.is_symlink() or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise RuntimeError('UNSAFE_LOCK_DIRECTORY')
    unit = unit_for(script)
    lock = os.open(runtime / (unit + '.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('AUDIT_ALREADY_RUNNING')
        # A launcher might have died while its systemd unit is still alive.
        state = ctl('show', unit, '-p', 'LoadState', '--value')
        if state.returncode == 0 and state.stdout.strip() != 'not-found':
            raise RuntimeError('AUDIT_UNIT_ALREADY_EXISTS')
        if state.returncode != 0 and 'not found' not in state.stderr.lower():
            raise RuntimeError('USER_MANAGER_UNAVAILABLE')
        return run_unit(a, script, node, unit, runtime)
    finally:
        os.close(lock)  # Do not unlink the lock inode.


def run_unit(a, script, node, unit, runtime):
    with tempfile.TemporaryDirectory(prefix='run-', dir=runtime) as tmp:
        ready = pathlib.Path(tmp) / 'ready.json'
        nonce = os.urandom(16).hex()
        description = 'CC bounded audit ' + nonce
        # Keep failed units long enough to read their manager-side OOM result.
        cmd = ['systemd-run', '--user', '--wait', '--pipe', '--quiet', '--unit=' + unit]
        props = {'Description': description, 'MemoryMax': str(a.memory_mib * 1048576), 'MemorySwapMax': '0', 'OOMPolicy': 'kill',
                 'MemoryAccounting': 'yes', 'KillMode': 'control-group', 'TasksMax': '32',
                 'RuntimeMaxSec': str(a.seconds), 'TimeoutStopSec': '1', 'NoNewPrivileges': 'yes',
                 'WorkingDirectory': str(pathlib.Path.cwd()), 'LimitCORE': '0'}
        cmd += ['--property=' + k + '=' + v for k, v in props.items()]
        cmd += [sys.executable, str(pathlib.Path(__file__).resolve()), '--worker', '--ready', str(ready),
                '--nonce', nonce, '--node', node, '--memory-mib', str(a.memory_mib), '--heap-mib',
                str(a.heap_mib), str(script), *a.args]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        sel = selectors.DefaultSelector()
        for label, stream in [('stdout', proc.stdout), ('stderr', proc.stderr)]:
            os.set_blocking(stream.fileno(), False)
            sel.register(stream, selectors.EVENT_READ, label)
        tails = {'stdout': b'', 'stderr': b''}
        total = 0
        owner = None
        reason = None
        stopped = False
        start = time.monotonic()
        metrics = {}
        received = []
        old_handlers = {}
        for sig in [signal.SIGINT, signal.SIGTERM]:
            old_handlers[sig] = signal.signal(sig, lambda signum, frame: received.append(signum))

        def stop_owned():
            nonlocal stopped
            if not stopped:
                # The unique manager description also proves our failed startup
                # belongs to this launch when the worker never reached ready.
                if manager_status():
                    stopped = ctl('stop', '--no-block', unit).returncode == 0

        def read_handshake():
            nonlocal owner
            if owner is None and ready.exists():
                data = json.loads(ready.read_text())
                expected = {'memory.max': str(a.memory_mib * 1048576), 'memory.swap.max': '0',
                            'memory.oom.group': '1', 'pids.max': '32'}
                if not isinstance(data, dict) or data.get('nonce') != nonce:
                    raise RuntimeError('GUARD_HANDSHAKE_INVALID')
                invocation = data.get('invocation')
                group = data.get('cgroup')
                if not isinstance(invocation, str) or len(invocation) != 32 or any(c not in '0123456789abcdef' for c in invocation):
                    raise RuntimeError('GUARD_HANDSHAKE_INVALID')
                if not isinstance(group, str) or not pathlib.Path(group).resolve().is_relative_to('/sys/fs/cgroup') or pathlib.Path(group).name != unit or data.get('limits') != expected:
                    raise RuntimeError('GUARD_HANDSHAKE_INVALID')
                owner = data  # Publish only a fully validated handshake.

        def manager_status():
            status = ctl('show', unit, '-p', 'InvocationID', '-p', 'Description', '-p', 'Result', '-p', 'MemoryPeak')
            fields = dict(line.split('=', 1) for line in status.stdout.splitlines() if '=' in line)
            ours = status.returncode == 0 and fields.get('Description') == description and bool(fields.get('InvocationID'))
            return fields if ours and (owner is None or fields['InvocationID'] == owner['invocation']) else {}

        try:
            while sel.get_map() or proc.poll() is None:
                read_handshake()
                if owner:
                    cg = pathlib.Path(owner['cgroup'])
                    for name in ['memory.peak', 'memory.events']:
                        try:
                            metrics[name] = (cg / name).read_text().strip()
                        except FileNotFoundError:
                            pass
                if reason is None:
                    if received:
                        reason = 'CANCELLED'
                    elif total > a.output_bytes:
                        reason = 'OUTPUT_LIMIT'
                    elif time.monotonic() - start > a.seconds + 1:
                        reason = 'TIME_LIMIT'
                if reason:
                    stop_owned()
                for key, _ in sel.select(0.05):
                    # Detect overflow at the first excess byte, then drain/drop
                    # during bounded shutdown so a noisy child cannot block us.
                    size = min(65536, max(1, a.output_bytes - total + 1)) if reason is None else 65536
                    data = os.read(key.fileobj.fileno(), size)
                    if data:
                        total += len(data)
                        tails[key.data] = (tails[key.data] + data)[-8192:]
                        if reason is None and total > a.output_bytes:
                            reason = 'OUTPUT_LIMIT'
                            stop_owned()
                    else:
                        sel.unregister(key.fileobj)
                        key.fileobj.close()
                if time.monotonic() - start > a.seconds + 12:
                    reason = reason or 'SUPERVISOR_DEADLINE'
                    stop_owned()
                    os.killpg(proc.pid, signal.SIGKILL)
                    break
            code = proc.wait(timeout=3)
            read_handshake()
            manager = manager_status()
            if manager:
                metrics['manager.result'] = manager.get('Result', '')
                peak = manager.get('MemoryPeak', '')
                if peak.isdigit():
                    metrics['memory.peak'] = peak
            # A failed/ended main process must not leave children behind.
            stop_owned()
            events = metrics.get('memory.events', '')
            if reason is None:
                if manager.get('Result') == 'oom-kill' or any(line.startswith('oom_kill ') and int(line.split()[1]) > 0 for line in events.splitlines()):
                    reason = 'MEMORY_LIMIT'
                elif manager.get('Result') == 'timeout':
                    reason = 'TIME_LIMIT'
                elif code:
                    reason = 'PROCESS_FAILED'
                elif owner is None:
                    reason = 'GUARD_NOT_VERIFIED'
                else:
                    reason = 'COMPLETED'
            result = {'reason': reason, 'exitCode': code, 'unit': unit, 'script': script.name,
                      'limitsVerified': owner is not None, 'limits': owner['limits'] if owner else None,
                      'seconds': round(time.monotonic() - start, 3), 'outputBytes': total,
                      'outputTruncated': total > sum(map(len, tails.values())), 'metrics': metrics,
                      'stdoutTail': tails['stdout'].decode(errors='replace'),
                      'stderrTail': tails['stderr'].decode(errors='replace')}
            print(json.dumps(result, ensure_ascii=False))
            return 0 if reason == 'COMPLETED' else 1
        finally:
            # Cleanup failures are independent. In particular, a corrupt ready
            # file or unavailable manager must not skip pipes/signal cleanup.
            def cleanup(action):
                try:
                    action()
                except Exception as error:
                    print('AUDIT_CLEANUP_WARNING: ' + type(error).__name__, file=sys.stderr)
            cleanup(read_handshake)
            cleanup(stop_owned)
            def reset_owned():
                if manager_status():
                    ctl('reset-failed', unit)
            cleanup(reset_owned)
            def kill_client():
                if proc.poll() is None:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    proc.wait(timeout=3)
            cleanup(kill_client)
            cleanup(sel.close)
            for stream in [proc.stdout, proc.stderr]:
                cleanup(stream.close)
            for sig, handler in old_handlers.items():
                cleanup(lambda sig=sig, handler=handler: signal.signal(sig, handler))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--memory-mib', type=int, default=512)
    p.add_argument('--heap-mib', type=int, default=128)
    p.add_argument('--seconds', type=int, default=120)
    p.add_argument('--output-bytes', type=int, default=1048576)
    p.add_argument('--node', default='node')
    p.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    p.add_argument('--ready', help=argparse.SUPPRESS)
    p.add_argument('--nonce', help=argparse.SUPPRESS)
    p.add_argument('script')
    p.add_argument('args', nargs=argparse.REMAINDER)
    a = p.parse_args()
    try:
        if a.worker:
            worker(a)
        else:
            return supervise(a)
    except Exception as e:
        print(json.dumps({'reason': str(e), 'success': False}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
