import { useRef, useState } from 'react';
import {
  Coffee,
  Compass,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  NotebookPen,
  Play,
  Plane,
  ShoppingBag,
  Sparkles,
  Square,
  Volume2,
  Briefcase,
} from 'lucide-react';
import {
  GeneratedConversation,
  NoteContextTag,
  ProficiencyLevel,
  VocabCard,
} from '../types/arabic';
import {
  applySmartPartialTashkeel,
  LEVEL_LABELS,
  speakArabic,
  stopArabicSpeech,
  stripTashkeel,
  unlockArabicAudioContext,
} from '../utils/arabic';

interface ConversationViewProps {
  cards: VocabCard[];
  selectedLevel: ProficiencyLevel;
  speechRate: number;
  notesCount?: number;
  onOpenNotes?: (context?: NoteContextTag) => void;
}

const SCENARIO_PRESETS = [
  { id: 'cafe', labelAr: 'في المقهى', labelEn: 'At the Café', Icon: Coffee },
  { id: 'market', labelAr: 'في السوق', labelEn: 'Local Market', Icon: ShoppingBag },
  { id: 'travel', labelAr: 'السفر والمطار', labelEn: 'Travel & Airport', Icon: Plane },
  { id: 'work', labelAr: 'العمل والدراسة', labelEn: 'Work & Study', Icon: Briefcase },
  { id: 'daily', labelAr: 'حوار يومي', labelEn: 'Everyday MSA', Icon: Compass },
] as const;

function buildClientFallbackConversation(
  level: ProficiencyLevel,
  scenarioId: string,
  customTopic: string,
  cards: VocabCard[]
): GeneratedConversation {
  const words = cards.slice(0, 6);
  const w1 = applySmartPartialTashkeel(words[0]?.wordWithTashkeel || 'القَهْوَةُ');
  const w2 = applySmartPartialTashkeel(words[1]?.wordWithTashkeel || 'السَّعَادَةُ');

  return {
    scenarioId: customTopic || scenarioId,
    titleAr: customTopic
      ? `حِوَارٌ حَوْلَ: ${customTopic}`
      : 'مُحَادَثَةٌ وَاقِعِيَّةٌ بِالعَرَبِيَّةِ الفُصْحَى',
    titleEn: customTopic ? `Scenario: ${customTopic}` : 'Everyday Modern Standard Arabic Dialogue',
    settingAr: 'تَدَرَّبْ عَلَى النُّطْقِ وَاسْتِخْدَامِ مُفْرَدَاتِكَ الجَدِيدَةِ فِي حِوَارٍ طَبِيعِيٍّ.',
    settingEn: 'Practice speaking and listening with your newly saved Arabic vocabulary.',
    level,
    targetWords: words.length > 0 ? words.map((w) => applySmartPartialTashkeel(w.wordWithTashkeel)) : [w1, w2],
    turns: [
      {
        id: 'fb-t1',
        speakerAr: 'لَيْلَى',
        speakerEn: 'Layla',
        role: 'partner',
        arabic: applySmartPartialTashkeel('أَهْلًا وَسَهْلًا! كَيْفَ حَالُكَ اليَوْمَ؟'),
        transliteration: 'ahlan wa-sahlan! kayfa ḥāluka al-yawm?',
        english: 'Welcome! How are you doing today?',
        usedWords: [],
      },
      {
        id: 'fb-t2',
        speakerAr: 'أَنْتَ',
        speakerEn: 'You',
        role: 'learner',
        arabic: applySmartPartialTashkeel(`بِخَيْرٍ وَالحَمْدُ لِلَّهِ! أَتَدَرَّبُ اليَوْمَ عَلَى اسْتِخْدَامِ كَلِمَةِ ${w1}.`),
        transliteration: 'bi-khayrin wa-l-ḥamdu lillāh! atadarrabu al-yawm ʿalā istikhdām hādhihi l-kalima.',
        english: `Doing well, thank you! Today I am practicing using the word "${w1}".`,
        usedWords: [w1],
      },
      {
        id: 'fb-t3',
        speakerAr: 'لَيْلَى',
        speakerEn: 'Layla',
        role: 'partner',
        arabic: applySmartPartialTashkeel(`مُمْتَازٌ! هَلْ تَشْعُرُ بِـ${w2} عِنْدَمَا تَقْرَأُ بِالعَرَبِيَّةِ؟`),
        transliteration: 'mumtāz! hal tashʿuru bi-hādha ʿindamā taqraʾu bi-l-ʿarabiyya?',
        english: `Excellent! Do you feel "${w2}" when you read in Arabic?`,
        usedWords: [w2],
      },
      {
        id: 'fb-t4',
        speakerAr: 'أَنْتَ',
        speakerEn: 'You',
        role: 'learner',
        arabic: applySmartPartialTashkeel('نَعَمْ، القِرَاءَةُ وَالمُحَادَثَةُ تَجْعَلَانِ التَّعَلُّمَ مُمْتِعًا جِدًّا.'),
        transliteration: 'naʿam, al-qirāʾatu wa-l-muḥādathatu tajʿalāni t-taʿalluma mumtiʿan jiddan.',
        english: 'Yes, reading and conversation make learning very enjoyable.',
        usedWords: [],
      },
    ],
    practiceSentences: (words.length > 0
      ? words.slice(0, 4)
      : [
          { wordWithTashkeel: 'القَهْوَةُ', englishMeaning: 'the coffee' },
          { wordWithTashkeel: 'السَّعَادَةُ', englishMeaning: 'happiness' },
        ]
    ).map((w, i) => {
      const ar = applySmartPartialTashkeel(w.wordWithTashkeel);
      return {
        id: `fb-ps-${i + 1}`,
        arabic: applySmartPartialTashkeel(`أَسْتَخْدِمُ كَلِمَةَ «${ar}» بِثِقَةٍ فِي الحِوَارِ.`),
        english: `I use the word "${ar}" (${w.englishMeaning}) confidently in dialogue.`,
        focusWordAr: ar,
        tipEn: 'Listen once, then repeat aloud matching the natural rhythm.',
      };
    }),
    source: 'fallback',
    notice: 'Built from offline dialogue templates.',
  };
}

export function ConversationView({
  cards,
  selectedLevel,
  speechRate,
  notesCount = 0,
  onOpenNotes,
}: ConversationViewProps) {
  const [convLevel, setConvLevel] = useState<ProficiencyLevel>(selectedLevel);
  const [scenarioId, setScenarioId] = useState<string>('cafe');
  const [customTopic, setCustomTopic] = useState('');
  const [showTranslations, setShowTranslations] = useState(true);
  const [showTashkeel, setShowTashkeel] = useState(true);

  const [conversation, setConversation] = useState<GeneratedConversation | null>(null);
  const [loading, setLoading] = useState(false);

  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [audioPhase, setAudioPhase] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [playingAll, setPlayingAll] = useState(false);
  const sequenceIdRef = useRef(0);

  const stopAllAudio = () => {
    sequenceIdRef.current += 1;
    stopArabicSpeech();
    setActiveAudioId(null);
    setAudioPhase('idle');
    setPlayingAll(false);
  };

  const handleGenerate = async () => {
    stopAllAudio();
    setLoading(true);
    const wordsPayload = cards.slice(0, 8).map((c) => ({
      wordWithTashkeel: c.wordWithTashkeel,
      englishMeaning: c.englishMeaning,
    }));

    try {
      const response = await fetch('/api/conversation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: convLevel,
          scenarioId,
          customTopic: customTopic.trim() || undefined,
          words: wordsPayload,
        }),
      });
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error('Conversation API unavailable.');
      }
      const data = (await response.json()) as GeneratedConversation;
      if (!Array.isArray(data?.turns) || data.turns.length === 0) {
        throw new Error('Empty dialogue.');
      }
      setConversation(data);
    } catch {
      setConversation(
        buildClientFallbackConversation(convLevel, scenarioId, customTopic.trim(), cards)
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSpeakItem = (id: string, arabicText: string) => {
    unlockArabicAudioContext();
    if (activeAudioId === id && !playingAll) {
      stopAllAudio();
      return;
    }
    sequenceIdRef.current += 1;
    setPlayingAll(false);
    speakArabic(arabicText, {
      rate: speechRate,
      mode: 'example',
      vocalizedText: arabicText,
      onLoading: () => {
        setActiveAudioId(id);
        setAudioPhase('loading');
      },
      onStart: () => {
        setActiveAudioId(id);
        setAudioPhase('playing');
      },
      onEnd: () => {
        setActiveAudioId((curr) => (curr === id ? null : curr));
        setAudioPhase('idle');
      },
      onError: () => {
        setActiveAudioId(null);
        setAudioPhase('idle');
      },
    });
  };

  const playTurnAt = (idx: number, seqId: number, turns: GeneratedConversation['turns']) => {
    if (sequenceIdRef.current !== seqId || idx >= turns.length) {
      if (sequenceIdRef.current === seqId) {
        setPlayingAll(false);
        setActiveAudioId(null);
        setAudioPhase('idle');
      }
      return;
    }
    const turn = turns[idx];
    let finished = false;
    speakArabic(turn.arabic, {
      rate: speechRate,
      mode: 'example',
      vocalizedText: turn.arabic,
      onLoading: () => {
        if (sequenceIdRef.current !== seqId) return;
        setActiveAudioId(turn.id);
        setAudioPhase('loading');
      },
      onStart: () => {
        if (sequenceIdRef.current !== seqId) return;
        setActiveAudioId(turn.id);
        setAudioPhase('playing');
      },
      onEnd: () => {
        if (finished || sequenceIdRef.current !== seqId) return;
        finished = true;
        playTurnAt(idx + 1, seqId, turns);
      },
      onError: () => {
        if (sequenceIdRef.current !== seqId) return;
        stopAllAudio();
      },
    });
  };

  const handlePlayFullDialogue = () => {
    unlockArabicAudioContext();
    if (!conversation) return;
    if (playingAll) {
      stopAllAudio();
      return;
    }
    const seqId = ++sequenceIdRef.current;
    setPlayingAll(true);
    playTurnAt(0, seqId, conversation.turns);
  };

  return (
    <section className="mx-auto max-w-4xl space-y-7 animate-fade-slide-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#DCE5D3] pb-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2718]">
              AI Conversation Studio
            </h1>
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-3xl font-bold text-[#2D3B22]"
            >
              المُحَادَثَةُ وَالسِّيَاقُ
            </span>
          </div>
          <p className="text-sm text-[#5A6552]">
            Generate real-life Arabic dialogues &amp; spoken practice sentences tailored to your level using your saved vocabulary.
          </p>
        </div>

        {onOpenNotes && (
          <button
            type="button"
            onClick={() =>
              onOpenNotes({
                type: 'conversation',
                label: conversation?.titleAr || 'المحادثة · Conversation',
              })
            }
            className="inline-flex items-center gap-2 self-start sm:self-auto rounded-xl border border-[#DCE5D3] bg-white px-4 py-2.5 text-sm font-semibold text-[#2D3B22] hover:bg-[#FBF3DC]/70 shadow-2xs transition-colors cursor-pointer"
          >
            <NotebookPen className="h-4 w-4 text-[#D4A338]" aria-hidden="true" />
            <span className="font-arabic-cairo">ملاحظاتي</span>
            {notesCount > 0 && (
              <span className="font-mono text-xs tabular-nums text-[#9A6F14]">
                ({notesCount})
              </span>
            )}
          </button>
        )}
      </div>

      {/* Scenario Setup Panel */}
      <div className="rounded-2xl border border-[#DCE5D3] bg-white p-5 sm:p-6 shadow-sm space-y-5">
        <div className="space-y-2">
          <span className="text-xs font-bold text-[#2D3B22]">Choose a Real-Life Scenario</span>
          <div className="flex flex-wrap gap-2">
            {SCENARIO_PRESETS.map(({ id, labelAr, labelEn, Icon }) => {
              const selected = scenarioId === id && !customTopic.trim();
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setScenarioId(id);
                    setCustomTopic('');
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    selected
                      ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A] shadow-xs'
                      : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#1F2718] hover:border-[#D4A338]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="font-arabic-cairo">{labelAr}</span>
                  <span className="opacity-80">· {labelEn}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="custom-conv-topic"
              className="text-xs font-bold text-[#2D3B22] block"
            >
              Or type a custom topic (Arabic or English)
            </label>
            <input
              id="custom-conv-topic"
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g., Ordering dinner, Visiting a museum..."
              className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3.5 py-2 text-sm text-[#1F2718] placeholder:text-[#6B7861] focus:border-[#2D3B22] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-bold text-[#2D3B22] block">Dialogue Level</span>
            <div className="flex flex-wrap gap-1.5">
              {(['beginner', 'intermediate', 'advanced'] as ProficiencyLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setConvLevel(lvl)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    convLevel === lvl
                      ? 'border-[#D4A338] bg-[#FBF3DC] text-[#1F2718]'
                      : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#5A6552] hover:text-[#1F2718]'
                  }`}
                >
                  <span className="font-arabic-cairo">{LEVEL_LABELS[lvl].ar}</span> · {LEVEL_LABELS[lvl].en}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF2E9] pt-4">
          <p className="text-xs text-[#5A6552]">
            {cards.length > 0
              ? `Weaving saved vocabulary: ${cards
                  .slice(0, 4)
                  .map((c) => stripTashkeel(c.wordWithTashkeel))
                  .join('، ')}`
              : 'Uses level-matched everyday Arabic vocabulary.'}
          </p>

          <button
            type="button"
            disabled={loading}
            onClick={handleGenerate}
            className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 shadow-sm transition-all cursor-pointer active:scale-[0.98]"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#FACC15]" aria-hidden="true" />
                <span>Creating Dialogue...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                <span>{conversation ? 'Generate New Dialogue' : 'توليد محادثة · Generate Dialogue'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Empty State */}
      {!conversation && !loading && (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white px-6 py-12 text-center space-y-3 shadow-2xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2E9] text-[#2D3B22]">
            <MessageSquare className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-bold text-[#1F2718]">
            Practice Real Arabic Conversations
          </h2>
          <p className="text-sm text-[#5A6552] max-w-md mx-auto">
            Select a scenario above and generate a full bilingual dialogue with expressive Arabic audio and sentences tailored to your level.
          </p>
        </div>
      )}

      {/* Generated Conversation Stage */}
      {conversation && (
        <div className="space-y-6 animate-fade-slide-up">
          {/* Scene Banner + Audio Toolbar */}
          <div className="rounded-2xl border border-[#DCE5D3] bg-white overflow-hidden shadow-sm">
            <div className="border-b border-[#DCE5D3] bg-gradient-to-br from-white via-[#FAFBF8] to-[#EEF2E9]/70 px-5 py-5 sm:px-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="font-display text-xl font-bold text-[#1F2718]">
                  {conversation.titleEn}
                </h2>
                <p className="text-xs text-[#5A6552]">{conversation.settingEn}</p>
              </div>
              <div dir="rtl" lang="ar" className="text-right space-y-1">
                <p className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]">
                  {showTashkeel
                    ? applySmartPartialTashkeel(conversation.titleAr)
                    : stripTashkeel(conversation.titleAr)}
                </p>
                {conversation.targetWords.length > 0 && (
                  <p className="font-arabic-cairo text-xs text-[#9A6F14] font-semibold">
                    المفردات المستخدمة: {conversation.targetWords.slice(0, 5).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            <div className="border-b border-[#DCE5D3] bg-[#EEF2E9]/60 px-5 py-3 sm:px-8 flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handlePlayFullDialogue}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  playingAll
                    ? 'bg-[#2D3B22] text-[#FEF08A] ring-4 ring-[#DCE5D3]'
                    : 'border border-[#DCE5D3] bg-white text-[#1F2718] hover:border-[#D4A338]'
                }`}
              >
                {playingAll ? (
                  <>
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Stop Full Dialogue</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                    <span>Listen to Full Dialogue · استمع للحوار</span>
                  </>
                )}
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTashkeel((prev) => !prev)}
                  className="rounded-xl border border-[#DCE5D3] bg-white px-3 py-1.5 text-xs font-semibold text-[#2D3B22] hover:bg-[#FAFBF8] cursor-pointer"
                >
                  {showTashkeel ? 'Smart Tashkeel: On' : 'Tashkeel: Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowTranslations((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3 py-1.5 text-xs font-semibold text-[#5A6552] hover:text-[#1F2718] cursor-pointer"
                >
                  {showTranslations ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{showTranslations ? 'Hide English' : 'Show English'}</span>
                </button>
              </div>
            </div>

            {/* Dialogue Bubbles */}
            <div className="p-5 sm:p-7 space-y-4">
              {conversation.turns.map((turn) => {
                const isLearner = turn.role === 'learner';
                const isThisAudio = activeAudioId === turn.id;
                const displayAr = showTashkeel
                  ? applySmartPartialTashkeel(turn.arabic)
                  : stripTashkeel(turn.arabic);

                return (
                  <div
                    key={turn.id}
                    className={`rounded-2xl border p-4 sm:p-5 transition-all ${
                      isThisAudio
                        ? 'border-[#D4A338] bg-[#FBF3DC]/60 ring-2 ring-[#D4A338]/35'
                        : isLearner
                          ? 'border-[#DCE5D3] bg-[#EEF2E9]/55 sm:mr-10'
                          : 'border-[#DCE5D3] bg-[#FAFBF8] sm:ml-10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 pb-2">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <span className="font-arabic-cairo text-[#2D3B22]">
                          {turn.speakerAr}
                        </span>
                        <span className="text-[#DCE5D3]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[#5A6552]">{turn.speakerEn}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSpeakItem(turn.id, turn.arabic)}
                        aria-label={`Listen to ${turn.speakerEn}`}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                          isThisAudio
                            ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A]'
                            : 'border-[#DCE5D3] bg-white text-[#9A6F14] hover:bg-[#FBF3DC]'
                        }`}
                      >
                        {isThisAudio && audioPhase === 'loading' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Volume2
                            className={`h-3.5 w-3.5 ${
                              isThisAudio && audioPhase === 'playing' ? 'animate-pulse' : ''
                            }`}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </div>

                    <p
                      dir="rtl"
                      lang="ar"
                      className="font-arabic-scheherazade text-2xl sm:text-[26px] text-[#1F2718] text-right leading-[2.05]"
                    >
                      {displayAr}
                    </p>

                    {showTranslations && (
                      <div className="mt-2.5 border-t border-[#DCE5D3]/70 pt-2 space-y-0.5">
                        {turn.transliteration && (
                          <p className="font-mono text-[11px] text-[#5A6552]">
                            {turn.transliteration}
                          </p>
                        )}
                        <p className="text-xs sm:text-sm font-medium text-[#2D3B22]">
                          {turn.english}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Practice Sentences with Vocabulary */}
          {conversation.practiceSentences.length > 0 && (
            <div className="rounded-2xl border border-[#DCE5D3] bg-white p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-baseline justify-between gap-2 border-b border-[#EEF2E9] pb-3">
                <h3 className="font-display text-lg font-bold text-[#1F2718]">
                  Key Speaking &amp; Vocabulary Sentences
                </h3>
                <span
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-cairo text-sm font-bold text-[#2D3B22]"
                >
                  جمل للتدريب والنطق
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {conversation.practiceSentences.map((sent) => {
                  const isThisAudio = activeAudioId === sent.id;
                  return (
                    <div
                      key={sent.id}
                      className="rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-arabic-cairo text-xs font-bold text-[#9A6F14]">
                          الكلمة: {sent.focusWordAr}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleSpeakItem(sent.id, sent.arabic)}
                          aria-label="Listen to practice sentence"
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                            isThisAudio
                              ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A]'
                              : 'border-[#DCE5D3] bg-white text-[#9A6F14] hover:bg-[#FBF3DC]'
                          }`}
                        >
                          {isThisAudio && audioPhase === 'loading' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Volume2
                              className={`h-3.5 w-3.5 ${
                                isThisAudio && audioPhase === 'playing' ? 'animate-pulse' : ''
                              }`}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </div>

                      <p
                        dir="rtl"
                        lang="ar"
                        className="font-arabic-scheherazade text-xl sm:text-2xl font-bold text-[#1F2718] text-right leading-[1.95]"
                      >
                        {showTashkeel
                          ? applySmartPartialTashkeel(sent.arabic)
                          : stripTashkeel(sent.arabic)}
                      </p>

                      {showTranslations && (
                        <div className="space-y-1 text-xs">
                          <p className="font-medium text-[#2D3B22]">{sent.english}</p>
                          <p className="text-[#5A6552]">{sent.tipEn}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
