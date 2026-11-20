import { useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import {
  Bookmark,
  CheckCircle2,
  Clock,
  RotateCw,
  Trash2,
  Volume2,
} from 'lucide-react';
import { PracticeStatus, SrsRating, VocabCard } from '../types/arabic';
import { enrichWordMeta } from '../data/fallbackLexicon';
import { applySmartPartialTashkeel, speakArabic, stopArabicSpeech } from '../utils/arabic';

interface Flashcard3DProps {
  card: VocabCard;
  speechRate?: number;
  large?: boolean;
  controlledFlipped?: boolean;
  onFlipChange?: (flipped: boolean) => void;
  onUpdateStatus?: (id: string, status: PracticeStatus) => void;
  onDelete?: (id: string) => void;
}

const SRS_META: Record<SrsRating, { label: string; colorClass: string }> = {
  hard: { label: 'Hard · Review Soon', colorClass: 'text-[#E11D48]' },
  good: { label: 'Good · 2d interval', colorClass: 'text-fuchsia-700' },
  easy: { label: 'Easy · 7d interval', colorClass: 'text-[#4C1D95]' },
};

export function Flashcard3D({
  card,
  speechRate = 0.92,
  large = false,
  controlledFlipped,
  onFlipChange,
  onUpdateStatus,
  onDelete,
}: Flashcard3DProps) {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<'word' | number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; ignored: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);

  const isFlipped = controlledFlipped !== undefined ? controlledFlipped : internalFlipped;

  const handleToggleFlip = () => {
    const next = !isFlipped;
    if (onFlipChange) {
      onFlipChange(next);
    } else {
      setInternalFlipped(next);
    }
  };

  const handleCardTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const startedOnButton = Boolean(target?.closest('button'));
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ignored: startedOnButton,
    };
  };

  const handleCardTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.ignored) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      suppressNextClickRef.current = true;
      handleToggleFlip();
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 350);
    }
  };

  const handleSpeak = (e: MouseEvent, text: string, key: 'word' | number) => {
    e.stopPropagation();
    if (speakingKey === key) {
      stopArabicSpeech();
      setSpeakingKey(null);
      return;
    }
    speakArabic(text, {
      rate: speechRate,
      onStart: () => setSpeakingKey(key),
      onEnd: () => setSpeakingKey((curr) => (curr === key ? null : curr)),
    });
  };

  const handleStatusToggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (!onUpdateStatus) return;
    onUpdateStatus(card.id, card.status === 'learned' ? 'needs_review' : 'learned');
  };

  const handleRemove = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.(card.id);
  };

  const heightClass = large ? 'min-h-[450px]' : 'min-h-[410px]';
  const srsInfo = card.srsRating ? SRS_META[card.srsRating] : null;
  const { wordType, root } = enrichWordMeta(
    card.wordWithTashkeel,
    card.partOfSpeech,
    card.wordType,
    card.root
  );

  return (
    <div className={`perspective-1400 w-full ${heightClass} select-none group`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          handleToggleFlip();
        }}
        onTouchStart={handleCardTouchStart}
        onTouchEnd={handleCardTouchEnd}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggleFlip();
          }
        }}
        aria-label={`Flashcard for ${card.wordWithTashkeel}. Tap, swipe, or press Enter to flip.`}
        className={`touch-card-surface relative h-full w-full ${heightClass} transform-style-3d flashcard-transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48] rounded-2xl ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
      >
        {/* FRONT SIDE: Arabic Word with Smart Partial Tashkeel + Context Sentences + Listen */}
        <div className="backface-hidden absolute inset-0 flex flex-col justify-between rounded-2xl border border-[#ECE8EF]/90 bg-white/95 backdrop-blur-md p-5 sm:p-6 shadow-sm group-hover:shadow-md transition-shadow overflow-y-auto overscroll-contain">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECE8EF] pb-3">
            <div className="flex items-center gap-2.5 text-xs font-semibold">
              {card.status === 'learned' ? (
                <span className="inline-flex items-center gap-1.5 text-[#4C1D95]">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Learned</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[#E11D48]">
                  <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Needs Review</span>
                </span>
              )}

              {srsInfo && (
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${srsInfo.colorClass}`}>
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{srsInfo.label}</span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => handleSpeak(e, card.wordWithTashkeel, 'word')}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer touch-manipulation ${
                speakingKey === 'word'
                  ? 'border-[#E11D48] bg-[#E11D48] text-white ring-4 ring-rose-200'
                  : 'border-rose-200/80 bg-rose-50 text-rose-900 hover:bg-rose-100'
              }`}
            >
              <Volume2
                className={`h-3.5 w-3.5 ${
                  speakingKey === 'word' ? 'text-white animate-pulse' : 'text-[#E11D48]'
                }`}
                aria-hidden="true"
              />
              <span>{speakingKey === 'word' ? 'Playing · استمع' : 'Pronounce · استمع'}</span>
            </button>
          </div>

          <div dir="rtl" lang="ar" className="py-2 text-center">
            <p
              className={`font-arabic-scheherazade font-bold text-[#241734] leading-[1.9] ${
                large ? 'text-5xl sm:text-6xl' : 'text-4xl sm:text-5xl'
              }`}
            >
              {applySmartPartialTashkeel(card.wordWithTashkeel)}
            </p>
            {(wordType || root) && (
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                {wordType && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#ECE8EF] bg-[#F7F4F9] px-2.5 py-0.5 text-[11px] font-medium text-[#4C1D95]">
                    <span className="text-zinc-500">نوع الكلمة:</span>
                    <span className="font-semibold">{wordType}</span>
                  </span>
                )}
                {root && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#ECE8EF] bg-[#F7F4F9] px-2.5 py-0.5 text-[11px] font-medium text-[#241734]">
                    <span className="text-zinc-500">الجذر:</span>
                    <span className="font-semibold">{root}</span>
                  </span>
                )}
              </div>
            )}
            <p className="mt-1.5 font-mono text-xs text-zinc-500" dir="ltr">
              {card.transliteration}
            </p>
          </div>

          <div dir="rtl" lang="ar" className="space-y-2 border-t border-[#ECE8EF] pt-3">
            {card.examples.slice(0, 3).map((ex, idx) => {
              const isPlayingSentence = speakingKey === idx;
              return (
                <div
                  key={idx}
                  className="flex items-start justify-between gap-2 rounded-xl bg-[#F7F4F9] border border-[#ECE8EF]/70 px-3.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    {ex.contextLabel && (
                      <p
                        dir="ltr"
                        className="text-[10px] font-bold uppercase tracking-wider text-[#E11D48] text-right mb-0.5"
                      >
                        {ex.contextLabel}
                      </p>
                    )}
                    <p className="font-arabic-scheherazade text-xl sm:text-[21px] leading-[2.15] text-[#241734]">
                      {applySmartPartialTashkeel(ex.arabic)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleSpeak(e, ex.arabic, idx)}
                    aria-label={`Listen to Arabic sentence ${idx + 1}`}
                    className={`mt-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all cursor-pointer ${
                      isPlayingSentence
                        ? 'bg-[#E11D48] text-white ring-2 ring-rose-200 animate-pulse'
                        : 'text-[#E11D48] hover:bg-rose-100'
                    }`}
                  >
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 pt-1">
            <span className="font-medium text-zinc-500">{card.partOfSpeech}</span>

            <span className="inline-flex items-center gap-1.5 font-semibold text-[#E11D48]">
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tap to flip</span>
            </span>
          </div>
        </div>

        {/* BACK SIDE: English meaning + contextual translations + SRS Controls */}
        <div
          dir="ltr"
          className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col justify-between rounded-2xl border border-rose-200/90 bg-gradient-to-br from-white via-[#FDFBFC] to-rose-50/45 p-5 sm:p-6 shadow-sm overflow-y-auto overscroll-contain"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECE8EF]/70 pb-3">
            <div className="flex items-center gap-2 text-xs text-zinc-600">
              <span className="font-semibold text-[#241734]">{card.partOfSpeech}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-zinc-500">{card.transliteration}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#E11D48]">
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Arabic front</span>
            </span>
          </div>

          <div className="py-2">
            <p className="text-xs font-semibold text-zinc-500 mb-1">English Meaning</p>
            <h3
              className={`font-display font-bold text-[#241734] ${
                large ? 'text-2xl' : 'text-xl'
              }`}
            >
              {card.englishMeaning}
            </h3>
          </div>

          <div className="space-y-2 border-t border-[#ECE8EF]/70 pt-3">
            <p className="text-xs font-semibold text-zinc-500">Context Translations</p>
            {card.examples.slice(0, 3).map((ex, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-[#ECE8EF]/80 bg-white/95 px-3.5 py-2 text-sm leading-relaxed text-zinc-800"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-xs font-bold text-[#E11D48]">
                    0{idx + 1}.
                  </span>
                  {ex.contextLabel && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#4C1D95]">
                      {ex.contextLabel}
                    </span>
                  )}
                </div>
                <p>{ex.english}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#ECE8EF]/70 pt-3">
            {onUpdateStatus ? (
              <button
                type="button"
                onClick={handleStatusToggle}
                className={`inline-flex min-h-[40px] sm:min-h-0 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer touch-manipulation ${
                  card.status === 'learned'
                    ? 'border border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100'
                    : 'bg-[#4C1D95] text-white hover:bg-[#581C87]'
                }`}
              >
                {card.status === 'learned' ? (
                  <>
                    <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Needs Review</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Mark Learned</span>
                  </>
                )}
              </button>
            ) : (
              <span className="text-xs text-zinc-500 truncate max-w-[180px]">
                {card.lessonTitle || 'Arabic Reading'}
              </span>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={handleRemove}
                aria-label={`Remove ${card.wordWithTashkeel} from vocabulary`}
                className="inline-flex min-h-[40px] sm:min-h-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-zinc-500 hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer touch-manipulation"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
