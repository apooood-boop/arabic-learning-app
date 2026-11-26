import { VocabCard } from '../types/arabic';
import { applySmartPartialTashkeel, stripTashkeel } from './arabic';
import { normalizeVocabTags } from './vocabTags';

function escapeCsvField(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getDateFilenameStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function triggerFileDownload(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportVocabularyAsCsv(cards: VocabCard[]) {
  const headers = [
    'Word (Arabic)',
    'Word (Unvoweled)',
    'Transliteration',
    'Part of Speech',
    'English Meaning',
    'Status',
    'SRS Rating',
    'Tags',
    'Lesson',
    'Context 1 Label',
    'Context 1 (Arabic)',
    'Context 1 (English)',
    'Context 2 Label',
    'Context 2 (Arabic)',
    'Context 2 (English)',
    'Context 3 Label',
    'Context 3 (Arabic)',
    'Context 3 (English)',
    'Saved At',
  ];

  const rows = cards.map((card) => {
    const wordAr = applySmartPartialTashkeel(card.wordWithTashkeel || card.word);
    const cardTags = normalizeVocabTags(card.tags);
    const ex0 = card.examples[0];
    const ex1 = card.examples[1];
    const ex2 = card.examples[2];

    const cells = [
      wordAr,
      stripTashkeel(wordAr),
      card.transliteration,
      card.partOfSpeech,
      card.englishMeaning,
      card.status === 'learned' ? 'Learned' : 'Needs Review',
      card.srsRating ?? '',
      cardTags.join('; '),
      card.lessonTitle ?? '',
      ex0?.contextLabel ?? '',
      ex0 ? applySmartPartialTashkeel(ex0.arabic) : '',
      ex0?.english ?? '',
      ex1?.contextLabel ?? '',
      ex1 ? applySmartPartialTashkeel(ex1.arabic) : '',
      ex1?.english ?? '',
      ex2?.contextLabel ?? '',
      ex2 ? applySmartPartialTashkeel(ex2.arabic) : '',
      ex2?.english ?? '',
      new Date(card.createdAt).toISOString(),
    ];

    return cells.map(escapeCsvField).join(',');
  });

  // Prepend UTF-8 BOM so Excel/Sheets preserve Arabic script and tashkeel cleanly
  const csvContent = '\uFEFF' + [headers.map(escapeCsvField).join(','), ...rows].join('\r\n');
  triggerFileDownload(
    csvContent,
    'text/csv;charset=utf-8;',
    `qalam-vocabulary-${getDateFilenameStamp()}.csv`
  );
}

export function exportVocabularyAsJson(cards: VocabCard[]) {
  const payload = {
    exportedAt: new Date().toISOString(),
    source: 'Qalam Arabic Learning Studio',
    totalWords: cards.length,
    words: cards.map((card) => ({
      wordArabic: applySmartPartialTashkeel(card.wordWithTashkeel || card.word),
      wordPlain: stripTashkeel(card.wordWithTashkeel || card.word),
      transliteration: card.transliteration,
      partOfSpeech: card.partOfSpeech,
      englishMeaning: card.englishMeaning,
      status: card.status,
      srsRating: card.srsRating ?? null,
      tags: normalizeVocabTags(card.tags),
      lessonTitle: card.lessonTitle ?? null,
      examples: card.examples.map((ex) => ({
        contextLabel: ex.contextLabel ?? null,
        arabic: applySmartPartialTashkeel(ex.arabic),
        english: ex.english,
      })),
      createdAt: new Date(card.createdAt).toISOString(),
    })),
  };

  triggerFileDownload(
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8;',
    `qalam-vocabulary-${getDateFilenameStamp()}.json`
  );
}
