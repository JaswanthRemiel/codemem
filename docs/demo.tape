# The README demo, about 20 seconds. Regenerate with: vhs docs/demo.tape
# Needs VHS (https://github.com/charmbracelet/vhs) and a built checkout (npm run build).
# Run it from the repository root. It needs the embedding model, so run `npx . doctor` once first.

Output docs/demo.gif

Require node

Set Shell bash
Set FontSize 16
Set Width 1200
Set Height 720
Set TypingSpeed 40ms
Set Padding 20

# Work on a throwaway copy of a fixture, with the build on the PATH as `remimem`.
Hide
Type `export DEMO=$(mktemp -d) && cp -R test/fixtures/ts-app/. $DEMO && alias remimem="node $PWD/dist/cli/index.js" && cd $DEMO && clear`
Enter
Sleep 1s
Show

Type "remimem init | head -4"
Enter
Sleep 5s

Type "remimem context 'check a password at login' --budget 400"
Enter
Sleep 6s

Type "remimem memory add 'Never log passwords in authenticateUser.' --kind convention --symbol authenticateUser"
Enter
Sleep 3s

Type "remimem stats | head -4"
Enter
Sleep 4s
