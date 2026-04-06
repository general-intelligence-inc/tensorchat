const fs = require("fs");
const path = require("path");

const filePath = path.join(
  __dirname,
  "..",
  "node_modules",
  "react-native",
  "Libraries",
  "Text",
  "TextInput",
  "Multiline",
  "RCTUITextView.mm",
);

const originalSnippet = [
  "  if (self = [super initWithFrame:frame]) {",
  "    [[NSNotificationCenter defaultCenter] addObserver:self",
  "                                             selector:@selector(textDidChange)",
  "                                                 name:UITextViewTextDidChangeNotification",
  "                                               object:self];",
  "",
  "    _placeholderView = [[UILabel alloc] initWithFrame:self.bounds];",
].join("\n");

const patchedSnippet = [
  "  if (self = [super initWithFrame:frame textContainer:nil]) {",
  "    [[NSNotificationCenter defaultCenter] addObserver:self",
  "                                             selector:@selector(textDidChange)",
  "                                                 name:UITextViewTextDidChangeNotification",
  "                                               object:self];",
  "",
  "    // React Native's multiline text input still relies on TextKit 1-era UITextView APIs such as",
  "    // `textContainer`, `contentSize`, and `scrollRangeToVisible:`. Starting in the legacy mode",
  "    // up front avoids UIKit switching modes lazily and spamming the console on iOS 18+.",
  "",
  "    _placeholderView = [[UILabel alloc] initWithFrame:self.bounds];",
].join("\n");

function main() {
  if (!fs.existsSync(filePath)) {
    console.warn(`[textkit-warning-patch] Skipping missing file: ${filePath}`);
    return;
  }

  const source = fs.readFileSync(filePath, "utf8");

  if (source.includes(patchedSnippet)) {
    console.log("[textkit-warning-patch] React Native UITextView patch already applied");
    return;
  }

  if (!source.includes(originalSnippet)) {
    throw new Error(
      "[textkit-warning-patch] Expected React Native UITextView snippet was not found. " +
        "React Native may have changed and the patch script needs an update.",
    );
  }

  const nextSource = source.replace(originalSnippet, patchedSnippet);
  fs.writeFileSync(filePath, nextSource);
  console.log("[textkit-warning-patch] Applied React Native UITextView patch");
}

main();