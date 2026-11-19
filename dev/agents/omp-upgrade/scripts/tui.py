# Drives the OMP interface in a pseudo-terminal: status line, guard silence, model picker, one turn, exit.
# python3 tui.py <dir> <model> <thinking> <json: title, outside, inside, noModels, summary, turnMark, status>. Prints {check: bool}.
import fcntl, json, os, pty, re, select, struct, sys, termios, time

folder, model, thinking, want = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(folder)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("omp", ["omp", "--model", model, "--thinking", thinking])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 160, 0, 0))
seen = ""

def pump(seconds):
    global seen
    end = time.time() + seconds
    while time.time() < end:
        if select.select([fd], [], [], 0.1)[0]:
            try:
                seen += os.read(fd, 65536).decode("utf-8", "replace")
            except OSError:
                return

def plain(text):
    return re.sub(r"\x1b\[[0-9;:?<>=]*[A-Za-z~]|\x1b\][^\x07]*\x07|\x1b[=>()][0-9A-B]?", "", text)

def wait(text, seconds, start=0):
    end = time.time() + seconds
    while time.time() < end:
        if text in plain(seen[start:]):
            return True
        pump(0.3)
    return False

def send(text, pause=0.0):
    for part in ([text] if not pause else text):
        os.write(fd, part.encode())
        time.sleep(pause)

out = {}
out["статуслайн"] = wait(want["status"], 40)
pump(3)
send("\x1b[1;2A")
out["пикер открылся"] = wait(want["title"], 10)
mark = len(seen)
send(want["outside"], 0.05)
out["пикер: модели вне списка нет"] = wait(want["noModels"], 5, mark)
send("\x7f" * len(want["outside"]), 0.05)
mark = len(seen)
send(want["inside"], 0.05)
pump(1.5)
out["пикер: модель из списка есть"] = "›" in plain(seen[mark:])
send("\x1b")
pump(1)
mark = len(seen)
send("Read a.txt with the read tool, then reply ok.")
time.sleep(0.5)
send("\r")
out["время хода"] = wait(want["turnMark"], 120, mark)
out["счётчик тулов"] = want["summary"] in plain(seen[mark:])
send("/exit", 0.4)
time.sleep(2)
send("\r")
end = time.time() + 10
gone = False
while time.time() < end and not gone:
    pump(0.3)
    gone = os.waitpid(pid, os.WNOHANG)[0] == pid
out["выход"] = gone
if not gone:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
pump(0.3)
out["сторож молчит"] = out["время хода"] and "\u2714 Read a.txt" in plain(seen[mark:]) and "rqw-base-tools:" not in plain(seen)
open(os.path.join(folder, "tty.raw"), "w").write(seen)
print(json.dumps(out, ensure_ascii=False))
