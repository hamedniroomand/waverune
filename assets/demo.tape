# The README recording. Render from the repository root with `bun run demo:gif`.
# Needs vhs 0.11.0 (https://github.com/charmbracelet/vhs), npm and network
# access. vhs 0.12.0 exits 0 and writes no file (charmbracelet/vhs#787).

Output assets/demo.gif

Set Shell bash
Set FontSize 20
Set Width 1100
Set Height 480
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 24
Set WindowBar Colorful

# Prepare a fresh directory with a sample file, and remove any existing
# global install so the install step shows real output. Not recorded.
Hide
Type "REPO=$PWD; cd $(mktemp -d) && bun $REPO/scripts/demo-wav.ts talk.wav && npm uninstall -g waverune >/dev/null 2>&1; clear"
Enter
Sleep 4s
Show

Type "npm install -g waverune"
Enter
Sleep 3s

Type "waverune embed talk.wav -o marked.wav --id 42 --key secret"
Enter
Sleep 6s

Type "waverune detect marked.wav --key secret"
Enter
Sleep 3s
