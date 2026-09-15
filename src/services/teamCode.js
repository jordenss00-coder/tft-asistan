// TFT istemcisindeki Takım Planlayıcı kodu: "02" + 10 slot × 3 hex karakter + "TFTSet<n>"

function decode(code, S) {
  const m = /^02([0-9a-f]{30})TFTSet(\d+)$/i.exec(String(code || '').trim());
  if (!m) return [];
  const units = [];
  for (let i = 0; i < 30; i += 3) {
    const v = parseInt(m[1].slice(i, i + 3), 16);
    const id = v ? S.codeToUnit[v] : null;
    if (id && !units.includes(id)) units.push(id);
  }
  return units;
}

function encode(units, S) {
  const codes = units.map((u) => S.teamPlannerCodes[u]).filter(Boolean).slice(0, 10);
  if (!codes.length) return null;
  return `02${codes.map((c) => c.toString(16).padStart(3, '0')).join('').padEnd(30, '0')}TFTSet${S.setNumber}`;
}

module.exports = { decode, encode };
