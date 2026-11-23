import { useState } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  Flame,
  GraduationCap,
  Loader2,
  NotebookPen,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Volume2,
  XCircle,
} from 'lucide-react';
import {
  GeneratedExam,
  NoteContextTag,
  ProficiencyLevel,
  SrsRating,
  VocabCard,
} from '../types/arabic';
import {
  applySmartPartialTashkeel,
  LEVEL_LABELS,
  normalizeStandaloneVocabWord,
  speakArabic,
  stopArabicSpeech,
  stripTashkeel,
  unlockArabicAudioContext,
} from '../utils/arabic';
import { generateExamClient } from '../utils/geminiClient';

interface ExamsViewProps {
  cards: VocabCard[];
  selectedLevel: ProficiencyLevel;
  speechRate: number;
  onRateSrs: (id: string, rating: SrsRating) => void;
  onRecordReview: () => void;
  onGoToLessons: () => void;
  notesCount?: number;
  onOpenNotes?: (context?: NoteContextTag) => void;
}

type ExamFocus = 'saved' | 'hard' | 'level';

function buildClientFallbackExam(
  cards: VocabCard[],
  level: ProficiencyLevel,
  count: number
): GeneratedExam {
  const pool = cards.length > 0 ? cards.slice(0, count) : [];
  const fallbackPool =
    pool.length > 0
      ? pool
      : [
          {
            id: 'fb-qahwa',
            wordWithTashkeel: 'القَهْوَةُ',
            englishMeaning: 'the coffee',
            examples: [
              {
                arabic: 'شَرِبْتُ القَهْوَةَ فِي الصَّبَاحِ.',
                english: 'I drank coffee in the morning.',
              },
            ],
          },
          {
            id: 'fb-hikma',
            wordWithTashkeel: 'الحِكْمَةُ',
            englishMeaning: 'wisdom',
            examples: [
              {
                arabic: 'تَأْتِي الحِكْمَةُ مِنَ التَّأَمُّلِ.',
                english: 'Wisdom comes from reflection.',
              },
            ],
          },
          {
            id: 'fb-saada',
            wordWithTashkeel: 'السَّعَادَةُ',
            englishMeaning: 'happiness',
            examples: [
              {
                arabic: 'السَّعَادَةُ فِي العَطَاءِ وَالقَنَاعَةِ.',
                english: 'Happiness lies in giving and contentment.',
              },
            ],
          },
        ];

  const backupMeanings = [
    'quiet hospitality',
    'ancient library',
    'morning journey',
    'creative knowledge',
  ];

  const questions = Array.from({ length: Math.min(count, Math.max(3, fallbackPool.length)) }).map(
    (_, idx) => {
      const card = fallbackPool[idx % fallbackPool.length];
      const isEdited = 'hasCustomEdits' in card && card.hasCustomEdits;
      const targetAr = isEdited
        ? card.wordWithTashkeel
        : applySmartPartialTashkeel(
            normalizeStandaloneVocabWord(card.wordWithTashkeel) || card.wordWithTashkeel
          );
      const meaning = card.englishMeaning;
      const otherMeanings = fallbackPool
        .filter((c) => c.englishMeaning !== meaning)
        .map((c) => c.englishMeaning);
      const distractors = [...new Set([...otherMeanings, ...backupMeanings])]
        .filter((m) => m.toLowerCase() !== meaning.toLowerCase())
        .slice(0, 3);
      const rawOpts = [meaning, ...distractors];
      const correctIndex = idx % rawOpts.length;
      const rotated = [...rawOpts];
      [rotated[0], rotated[correctIndex]] = [rotated[correctIndex], rotated[0]];

      return {
        id: `offline-exam-${idx + 1}`,
        type: 'meaning' as const,
        targetCardId: 'createdAt' in card ? card.id : undefined,
        targetWordAr: targetAr,
        promptAr: `ما المَعْنَى الدَّقِيقُ لِكَلِمَةِ «${targetAr}»؟`,
        promptEn: `Choose the accurate English meaning for "${targetAr}":`,
        contextSentenceAr: card.examples?.[0]?.arabic
          ? applySmartPartialTashkeel(card.examples[0].arabic)
          : undefined,
        options: rotated,
        correctIndex,
        explanationEn: `"${targetAr}" means "${meaning}".`,
        explanationAr: `الكلمةُ «${targetAr}» تعني "${meaning}".`,
      };
    }
  );

  return {
    titleEn: `${LEVEL_LABELS[level].en} Vocabulary Exam`,
    titleAr: `امتحانُ المفرداتِ — المستوى ${LEVEL_LABELS[level].ar}`,
    level,
    questions,
    source: 'fallback',
    notice: 'Built from your saved vocabulary deck.',
  };
}

export function ExamsView({
  cards,
  selectedLevel,
  speechRate,
  onRateSrs,
  onRecordReview,
  onGoToLessons,
  notesCount = 0,
  onOpenNotes,
}: ExamsViewProps) {
  const [examLevel, setExamLevel] = useState<ProficiencyLevel>(selectedLevel);
  const [focus, setFocus] = useState<ExamFocus>('saved');
  const [questionCount, setQuestionCount] = useState<5 | 8 | 10>(5);

  const [exam, setExam] = useState<GeneratedExam | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [showSummary, setShowSummary] = useState(false);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing'>('idle');

  const hardCards = cards.filter((c) => c.srsRating === 'hard');

  const handleGenerateExam = async (overrideFocus?: ExamFocus) => {
    const activeFocus = overrideFocus ?? focus;
    stopArabicSpeech();
    setAudioState('idle');
    setLoading(true);
    setError(null);
    setSelectedAnswers({});
    setCurrentIdx(0);
    setShowSummary(false);

    const candidateCards =
      activeFocus === 'hard' && hardCards.length > 0
        ? hardCards
        : activeFocus === 'level'
          ? cards.filter((c) => !c.level || c.level === examLevel)
          : cards;
    const wordsPayload = (candidateCards.length > 0 ? candidateCards : cards)
      .slice(0, 14)
      .map((c) => ({
        id: c.id,
        wordWithTashkeel: c.wordWithTashkeel,
        englishMeaning: c.englishMeaning,
        partOfSpeech: c.partOfSpeech,
        exampleAr: c.examples[0]?.arabic,
        exampleEn: c.examples[0]?.english,
      }));

    const fallbackBuilder = () =>
      buildClientFallbackExam(
        candidateCards.length > 0 ? candidateCards : cards,
        examLevel,
        questionCount
      );

    try {
      const data = await generateExamClient({
        level: examLevel,
        focus: activeFocus,
        count: questionCount,
        words: wordsPayload,
        fallbackBuilder,
      });
      setExam(data);
    } catch {
      setExam(fallbackBuilder());
    } finally {
      setLoading(false);
    }
  };

  const handleListen = (arabicText: string, mode: 'word' | 'example') => {
    unlockArabicAudioContext();
    if (audioState === 'loading') {
      return;
    }
    if (audioState !== 'idle') {
      stopArabicSpeech();
      setAudioState('idle');
      return;
    }
    speakArabic(arabicText, {
      rate: speechRate,
      mode,
      vocalizedText: arabicText,
      onLoading: () => setAudioState('loading'),
      onStart: () => setAudioState('playing'),
      onEnd: () => setAudioState('idle'),
      onError: () => setAudioState('idle'),
    });
  };

  const currentQuestion = exam?.questions[currentIdx] ?? null;

  const handlePickOption = (optionIdx: number) => {
    if (!currentQuestion || selectedAnswers[currentQuestion.id] !== undefined) return;
    setSelectedAnswers((prev) => ({ ...prev, [currentQuestion.id]: optionIdx }));
    const isCorrect = optionIdx === currentQuestion.correctIndex;
    onRecordReview();
    if (currentQuestion.targetCardId) {
      onRateSrs(currentQuestion.targetCardId, isCorrect ? 'good' : 'hard');
    }
  };

  const answeredCount = exam
    ? exam.questions.filter((q) => selectedAnswers[q.id] !== undefined).length
    : 0;
  const correctCount = exam
    ? exam.questions.filter((q) => selectedAnswers[q.id] === q.correctIndex).length
    : 0;

  return (
    <section className="mx-auto max-w-4xl space-y-7 animate-fade-slide-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#DCE5D3] pb-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2718]">
              Smart Exams
            </h1>
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-3xl font-bold text-[#2D3B22]"
            >
              الامْتِحَانَاتُ الذَّكِيَّةُ
            </span>
          </div>
          <p className="text-sm text-[#5A6552]">
            AI-crafted vocabulary &amp; comprehension exams built directly from your newly saved words and level.
          </p>
        </div>

        {onOpenNotes && (
          <button
            type="button"
            onClick={() =>
              onOpenNotes({
                type: 'exam',
                label: 'الامتحانات · Exams',
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

      {/* Exam Builder Controls */}
      <div className="rounded-2xl border border-[#DCE5D3] bg-white p-5 sm:p-6 shadow-sm space-y-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {/* Focus Selector */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-[#2D3B22]">Exam Focus</span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'saved', label: `Saved Words (${cards.length})` },
                  { id: 'hard', label: `Hard (${hardCards.length})` },
                  { id: 'level', label: 'Level Mix' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFocus(item.id)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    focus === item.id
                      ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A]'
                      : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#5A6552] hover:text-[#1F2718]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Proficiency Level */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-[#2D3B22]">Difficulty Level</span>
            <div className="flex flex-wrap gap-1.5">
              {(['beginner', 'intermediate', 'advanced'] as ProficiencyLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setExamLevel(lvl)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    examLevel === lvl
                      ? 'border-[#D4A338] bg-[#FBF3DC] text-[#1F2718]'
                      : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#5A6552] hover:text-[#1F2718]'
                  }`}
                >
                  <span className="font-arabic-cairo">{LEVEL_LABELS[lvl].ar}</span> · {LEVEL_LABELS[lvl].en}
                </button>
              ))}
            </div>
          </div>

          {/* Question Count */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-[#2D3B22]">Questions</span>
            <div className="flex items-center gap-2">
              {([5, 8, 10] as const).map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setQuestionCount(cnt)}
                  className={`rounded-xl border px-3.5 py-1.5 font-mono text-xs font-bold transition-colors cursor-pointer ${
                    questionCount === cnt
                      ? 'border-[#2D3B22] bg-[#2D3B22] text-white'
                      : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#5A6552] hover:text-[#1F2718]'
                  }`}
                >
                  {cnt} Qs
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF2E9] pt-4">
          <p className="text-xs text-[#5A6552]">
            {cards.length > 0
              ? `Incorporating words like ${cards
                  .slice(0, 3)
                  .map((c) => stripTashkeel(c.wordWithTashkeel))
                  .join('، ')}`
              : 'Save words from Lessons to personalize exams, or test essential Arabic vocabulary now.'}
          </p>

          <button
            type="button"
            disabled={loading}
            onClick={() => handleGenerateExam()}
            className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 shadow-sm transition-all cursor-pointer active:scale-[0.98]"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#FACC15]" aria-hidden="true" />
                <span>Generating Exam...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                <span>{exam ? 'Generate Fresh Exam' : 'إنشاء امتحان · Start AI Exam'}</span>
              </>
            )}
          </button>
        </div>

        {error && (
          <p className="rounded-xl border border-orange-200 bg-[#FEF2E8] px-3.5 py-2 text-xs text-amber-950">
            {error}
          </p>
        )}
      </div>

      {/* Interactive Exam Stage */}
      {!exam && !loading && (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white px-6 py-12 text-center space-y-4 shadow-2xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2E9] text-[#2D3B22]">
            <GraduationCap className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display text-xl font-bold text-[#1F2718]">
              Ready to Test Your Retention
            </h2>
            <p className="text-sm text-[#5A6552] max-w-md mx-auto">
              Click <span className="font-semibold text-[#2D3B22]">Start AI Exam</span> above to test contextual meaning, sentence completion, and usage of your saved Arabic vocabulary.
            </p>
          </div>
          {cards.length === 0 && (
            <button
              type="button"
              onClick={onGoToLessons}
              className="rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-4 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] cursor-pointer"
            >
              Browse Lessons to Save Words
            </button>
          )}
        </div>
      )}

      {exam && showSummary && (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white p-8 text-center shadow-sm space-y-6 animate-game-pop">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FBF3DC] text-[#9A6F14]">
            <Award className="h-6 w-6 text-[#D4A338]" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-3xl font-bold text-[#2D3B22]">
              نَتِيجَةُ الامْتِحَانِ
            </p>
            <h2 className="font-display text-2xl font-bold text-[#1F2718]">{exam.titleEn}</h2>
            <p className="text-sm text-[#5A6552]">
              You scored <strong className="font-mono text-[#1F2718]">{correctCount}</strong> out of{' '}
              <strong className="font-mono text-[#1F2718]">{exam.questions.length}</strong> (
              <strong className="font-mono text-[#2D3B22]">
                {Math.round((correctCount / Math.max(1, exam.questions.length)) * 100)}%
              </strong>
              ).
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedAnswers({});
                setCurrentIdx(0);
                setShowSummary(false);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-[#DCE5D3] bg-white px-4.5 py-2.5 text-sm font-semibold text-[#1F2718] hover:bg-[#EEF2E9] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4 text-[#2D3B22]" aria-hidden="true" />
              <span>Retake Same Exam</span>
            </button>
            <button
              type="button"
              onClick={() => handleGenerateExam()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] cursor-pointer"
            >
              <RefreshCw className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
              <span>New AI Exam</span>
            </button>
          </div>
        </div>
      )}

      {exam && !showSummary && currentQuestion && (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white p-6 sm:p-8 shadow-sm space-y-6 animate-fade-slide-up">
          {/* Exam Top Progress */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#5A6552]">
              <span className="font-semibold text-[#1F2718]">
                {exam.titleEn} · Q{currentIdx + 1}/{exam.questions.length}
              </span>
              <span>
                Score: {correctCount}/{answeredCount}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF2E9]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FACC15] to-[#2D3B22] transition-all duration-300"
                style={{
                  width: `${((currentIdx + 1) / exam.questions.length) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Question Prompt */}
          <div className="rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#9A6F14]">
                  {currentQuestion.type === 'fill_blank'
                    ? 'Fill in the Blank'
                    : currentQuestion.type === 'usage'
                      ? 'Contextual Usage'
                      : 'Meaning & Retention'}
                </span>
                <p className="text-sm font-semibold text-[#1F2718]">
                  {currentQuestion.promptEn}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleListen(
                    currentQuestion.contextSentenceAr || currentQuestion.targetWordAr,
                    currentQuestion.contextSentenceAr ? 'example' : 'word'
                  )
                }
                aria-label="Listen to question audio"
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                  audioState !== 'idle'
                    ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A]'
                    : 'border-[#DCE5D3] bg-white text-[#9A6F14] hover:bg-[#FBF3DC]'
                }`}
              >
                {audioState === 'loading' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Volume2
                    className={`h-3.5 w-3.5 ${audioState === 'playing' ? 'animate-pulse' : ''}`}
                    aria-hidden="true"
                  />
                )}
                <span>Listen</span>
              </button>
            </div>

            <p
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-2xl sm:text-3xl font-bold text-[#2D3B22] text-right leading-[1.9]"
            >
              {applySmartPartialTashkeel(currentQuestion.promptAr)}
            </p>

            {currentQuestion.contextSentenceAr && (
              <div className="rounded-xl border border-[#DCE5D3] bg-white px-4 py-3">
                <p
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-scheherazade text-xl sm:text-2xl text-[#1F2718] text-right leading-[2.0]"
                >
                  {applySmartPartialTashkeel(currentQuestion.contextSentenceAr)}
                </p>
              </div>
            )}
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {currentQuestion.options.map((opt, oIdx) => {
              const chosenIdx = selectedAnswers[currentQuestion.id];
              const isAnswered = chosenIdx !== undefined;
              const isPicked = chosenIdx === oIdx;
              const isCorrect = oIdx === currentQuestion.correctIndex;
              const isArabicOpt = /[\u0600-\u06FF]/.test(opt);

              let cls =
                'border-[#DCE5D3] bg-white text-[#1F2718] hover:border-[#D4A338] hover:bg-[#FAFBF8]';
              if (isAnswered) {
                if (isCorrect) {
                  cls = 'border-[#2D3B22] bg-[#EEF2E9] text-[#2D3B22] ring-2 ring-[#2D3B22]/20';
                } else if (isPicked) {
                  cls = 'border-[#C2410C] bg-[#FEF2E8] text-[#9A3412] ring-2 ring-[#C2410C]/20';
                } else {
                  cls = 'border-[#DCE5D3]/70 bg-[#FAFBF8] text-[#6B7861]';
                }
              }

              return (
                <button
                  key={`${currentQuestion.id}-opt-${oIdx}`}
                  type="button"
                  disabled={isAnswered}
                  onClick={() => handlePickOption(oIdx)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                    !isAnswered ? 'cursor-pointer' : 'cursor-default'
                  } ${cls}`}
                >
                  <span
                    dir={isArabicOpt ? 'rtl' : 'ltr'}
                    lang={isArabicOpt ? 'ar' : 'en'}
                    className={
                      isArabicOpt
                        ? 'font-arabic-scheherazade text-xl font-bold flex-1 text-right'
                        : 'text-sm font-semibold'
                    }
                  >
                    {opt}
                  </span>
                  {isAnswered && isCorrect && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2D3B22]" aria-hidden="true" />
                  )}
                  {isAnswered && isPicked && !isCorrect && (
                    <XCircle className="h-4 w-4 shrink-0 text-[#C2410C]" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Feedback + Next */}
          {selectedAnswers[currentQuestion.id] !== undefined && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/70 px-4 py-3 animate-fade-slide-up">
              <div className="space-y-0.5 text-xs">
                <p className="font-semibold text-[#1F2718]">
                  {currentQuestion.explanationEn}
                </p>
                {currentQuestion.explanationAr && (
                  <p dir="rtl" lang="ar" className="font-arabic-cairo text-[#2D3B22]">
                    {currentQuestion.explanationAr}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  stopArabicSpeech();
                  setAudioState('idle');
                  if (currentIdx + 1 >= exam.questions.length) {
                    setShowSummary(true);
                  } else {
                    setCurrentIdx((i) => i + 1);
                  }
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2D3B22] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3E522D] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>
                  {currentIdx + 1 >= exam.questions.length ? 'Finish & View Score' : 'Next Question'}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
              </button>
            </div>
          )}

          {exam.questions[currentIdx]?.targetCardId && (
            <div className="flex items-center gap-1.5 text-[11px] text-[#5A6552]">
              <Flame className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
              <span>Missed words are automatically queued as Hard in your SRS deck.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
