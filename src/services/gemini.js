const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// En düşük maliyetli güncel Flash-Lite modeli. Ayarlar'dan değiştirilebilir.
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

async function generate({ apiKey, model = DEFAULT_MODEL, system, contents, maxTokens = 4096, jsonMode = false }) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: jsonMode ? 0 : 0.5, maxOutputTokens: maxTokens, ...(jsonMode ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('Gemini API anahtarı geçersiz.');
    if (res.status === 403) throw new Error('Gemini API anahtarının bu modele erişimi yok.');
    if (res.status === 404) throw new Error(`"${model}" modeli bulunamadı. Ayarlar'da "Modelleri getir" ile başka bir model seç.`);
    if (res.status === 429) throw new Error('Gemini kullanım limiti aşıldı. Biraz bekleyip tekrar dene.');
    throw new Error(`Gemini hatası: ${msg}`);
  }
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error(`Gemini boş yanıt döndürdü${cand?.finishReason ? ` (${cand.finishReason})` : ''}.`);
  return { text, usage: json.usageMetadata || null };
}

async function listModels(apiKey) {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Modeller alınamadı (HTTP ${res.status}).`);
  const rank = (id) => (/flash-lite/.test(id) ? 0 : /flash/.test(id) ? 1 : 2);
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
    .sort((a, b) => rank(a.id) - rank(b.id) || b.id.localeCompare(a.id));
}

module.exports = { generate, listModels, DEFAULT_MODEL };
