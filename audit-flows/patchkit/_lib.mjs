// Shared applier: assert each anchor matches exactly once, apply, syntax-check, write.
import fs from 'fs';
export function apply(file, patches, label) {
  if (!fs.existsSync(file)) { console.error(`✗ ${label}: no such file: ${file}`); process.exit(1); }
  const orig = fs.readFileSync(file, 'utf8');
  let out = orig;
  patches.forEach((p, i) => {
    const n = out.split(p.find).length - 1;
    if (n !== 1) {
      console.error(`✗ ${label} patch ${i + 1} (${p.name}): anchor matched ${n} times, expected exactly 1.`);
      console.error(`  Anchor starts: ${p.find.split('\n')[0].slice(0, 90)}`);
      console.error('  NOTHING WAS WRITTEN. The source has drifted from the deployed node body.');
      process.exit(1);
    }
    out = out.replace(p.find, p.replace);
    console.log(`  ✓ ${p.name}`);
  });
  try { new Function(out); } catch (e) {
    console.error(`✗ ${label}: patched file does not parse: ${e.message}`);
    console.error('  NOTHING WAS WRITTEN.');
    process.exit(1);
  }
  fs.writeFileSync(file + '.patched', out);
  console.log(`✓ ${label}: ${orig.length} -> ${out.length} chars. Wrote ${file}.patched`);
  console.log(`  Review with:  diff -u "${file}" "${file}.patched"`);
  console.log(`  Then:         mv "${file}.patched" "${file}"`);
}
