import { useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import {
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Loader2,
  Pencil,
  RotateCw,
  Sparkles,
  Tag,
  Trash2,
  Volume2,
} from 'lucide-react';
import { SrsRating, VocabCard } from '../types/arabic';
import { enrichWordMeta, getLexiconSpeechText } from '../data/fallbackLexicon';
import {
  applySmartPartialTashkeel,
  LEVEL_LABELS,
  speakArabic,
  stopArabicSpeech,
  unlockArabicAudioContext,
} from '../utils/arabic';
import { normalizeVocabTags } from '../utils/vocabTags';

interface Flashcard3DProps {
  card: VocabCard;
  speechRate?: number;
  large?: boolean;
  controlledFlipped?: boolean;
  onFlipChange?: (flipped: boolean) => void;
  onRateSrs?: (id: string, rating: SrsRating) => void;
  onEdit?: (card: VocabCard) => void;
  onDelete?: (id: string) => void;
  onSpeakTranslation?: (card: VocabCard) => void;
  isSpeakingTranslation?: boolean;
  onPrevCard?: () => void;
  onNextCard?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
  cardPositionLabel?: string;
}

const SRS_META: Record<SrsRating, { label: string; colorClass: string }> = {
  hard: { label: 'Hard · Review Soon', colorClass: 'text-[#C2410C]' },
  good: { label: 'Good · 2d interval', colorClass: 'text-[#9A6F14]' },
  easy: { label: 'Easy · 7d interval', colorClass: 'text-[#2D3B22]' },
};

export function Flashcard3D({
  card,
  speechRate = 0.92,
  large = false,
  controlledFlipped,
  onFlipChange,
  onRateSrs,
  onEdit,
  onDelete,
  onSpeakTranslation,
  isSpeakingTranslation = false,
  onPrevCard,
  onNextCard,
  canGoPrev = false,
  canGoNext = false,
  cardPositionLabel,
}: Flashcard3DProps) {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<'word' | number | null>(null);
  const [speakingPhase, setSpeakingPhase] = useState<'idle' | 'loading' | 'playing'>('idle');
  const touchStartRef = useRef<{ x: number; y: number; ignored: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);

  const isFlipped = controlledFlipped !== undefined ? controlledFlipped : internalFlipped;
  const hasCardNav = Boolean(onPrevCard || onNextCard);

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
    const startedOnControl = Boolean(target?.closest('button, a, input, textarea'));
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ignored: startedOnControl,
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

    // Horizontal swipe flips cleanly
    if (Math.abs(dx) >= 54 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressNextClickRef.current = true;
      handleToggleFlip();
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 320);
      return;
    }

    // Vertical scroll drag inside long back content should not trigger an accidental tap flip
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 280);
    }
  };

  const handleSpeak = (e: MouseEvent, text: string, key: 'word' | number) => {
    e.stopPropagation();
    unlockArabicAudioContext();
    if (speakingPhase === 'loading') {
      return;
    }
    if (speakingKey === key) {
      stopArabicSpeech();
      setSpeakingKey(null);
      setSpeakingPhase('idle');
      return;
    }
    if (key === 'word') {
      const vocalizedText = card.hasCustomEdits
        ? card.wordWithTashkeel
        : card.vocalizedWord ||
          getLexiconSpeechText(
            card.word,
            card.wordWithTashkeel,
            wordType,
            card.partOfSpeech
          );
      speakArabic(text, {
        rate: speechRate,
        mode: 'word',
        vocalizedText,
        meaningHint: card.englishMeaning,
        wordType,
        partOfSpeech: card.partOfSpeech,
        onLoading: () => {
          setSpeakingKey(key);
          setSpeakingPhase('loading');
        },
        onStart: () => {
          setSpeakingKey(key);
          setSpeakingPhase('playing');
        },
        onEnd: () => {
          setSpeakingKey((curr) => {
            if (curr === key) {
              setSpeakingPhase('idle');
              return null;
            }
            return curr;
          });
        },
        onError: () => {
          setSpeakingKey(null);
          setSpeakingPhase('idle');
        },
      });
    } else {
      speakArabic(text, {
        rate: speechRate,
        mode: 'example',
        vocalizedText: text,
        onLoading: () => {
          setSpeakingKey(key);
          setSpeakingPhase('loading');
        },
        onStart: () => {
          setSpeakingKey(key);
          setSpeakingPhase('playing');
        },
        onEnd: () => {
          setSpeakingKey((curr) => {
            if (curr === key) {
              setSpeakingPhase('idle');
              return null;
            }
            return curr;
          });
        },
        onError: () => {
          setSpeakingKey(null);
          setSpeakingPhase('idle');
        },
      });
    }
  };

  const handleRemove = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.(card.id);
  };

  const handlePrevClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canGoPrev) return;
    onPrevCard?.();
  };

  const handleNextClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canGoNext) return;
    onNextCard?.();
  };

  const heightClass = large
    ? 'h-[min(72dvh,500px)] sm:h-[490px]'
    : 'h-[min(66dvh,450px)] sm:h-[440px]';
  const srsInfo = card.srsRating ? SRS_META[card.srsRating] : null;
  const cardTags = normalizeVocabTags(card.tags);
  const { wordType, root } = enrichWordMeta(
    card.wordWithTashkeel,
    card.partOfSpeech,
    card.wordType,
    card.root
  );

  const renderInlineCardNav = (compact = false) => {
    if (!hasCardNav) return null;
    return (
      <div
        className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/70 p-0.5 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handlePrevClick}
          disabled={!canGoPrev}
          aria-label="Previous flashcard"
          title="Previous card"
          className={`inline-flex items-center justify-center rounded-lg text-[#2D3B22] hover:bg-white disabled:opacity-35 transition-colors cursor-pointer touch-manipulation ${
            compact ? 'h-8 w-8' : 'h-9 w-9 sm:h-8 sm:w-8'
          }`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {cardPositionLabel && (
          <span className="px-1.5 font-mono text-[11px] font-bold tabular-nums text-[#2D3B22]">
            {cardPositionLabel}
          </span>
        )}
        <button
          type="button"
          onClick={handleNextClick}
          disabled={!canGoNext}
          aria-label="Next flashcard"
          title="Next card"
          className={`inline-flex items-center justify-center rounded-lg bg-[#2D3B22] text-[#FACC15] hover:bg-[#3B4D2B] disabled:opacity-35 transition-colors cursor-pointer touch-manipulation ${
            compact ? 'h-8 w-8' : 'h-9 w-9 sm:h-8 sm:w-8'
          }`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <div className={`perspective-1400 w-full ${heightClass} group`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (window.getSelection()?.toString().trim()) {
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
        className={`touch-card-surface touch-pan-y relative h-full w-full ${heightClass} card-flip cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] rounded-2xl ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
      >
        {/* FRONT SIDE: Clean Target Arabic Word Only (No Arabic Context Examples) */}
        <div
          className={`backface-hidden absolute inset-0 flex flex-col justify-between rounded-2xl border border-[#D4DFC8] bg-white p-4 sm:p-6 shadow-sm group-hover:shadow-md transition-shadow overflow-hidden ${
            isFlipped ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
        >
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE5D3]/80 pb-3 select-none">
            <div className="flex items-center gap-2 text-xs font-semibold">
              {card.status === 'learned' ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#EEF2E9] px-2.5 py-1 text-[#2D3B22]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#2D3B22]" aria-hidden="true" />
                  <span>Learned</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#FBF3DC] px-2.5 py-1 text-[#9A6F14]">
                  <Bookmark className="h-3.5 w-3.5 text-[#FACC15] fill-[#FACC15]/25" aria-hidden="true" />
                  <span>Needs Review</span>
                </span>
              )}

              {srsInfo && (
                <span className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold ${srsInfo.colorClass}`}>
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{srsInfo.label}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {onEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(card);
                  }}
                  aria-label={`تعديل / Edit ${card.wordWithTashkeel}`}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#5A6552] hover:border-[#2D3B22]/40 hover:bg-[#EEF2E9] hover:text-[#2D3B22] transition-colors cursor-pointer touch-manipulation"
                >
                  <Pencil className="h-3 w-3 text-[#9A6F14]" aria-hidden="true" />
                  <span className="font-arabic-cairo">تعديل</span>
                  <span aria-hidden="true" className="hidden sm:inline text-[#DCE5D3]">/</span>
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}

              <button
                type="button"
                onClick={(e) => handleSpeak(e, card.wordWithTashkeel, 'word')}
                aria-busy={speakingKey === 'word' && speakingPhase === 'loading'}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer touch-manipulation ${
                  speakingKey === 'word'
                    ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FACC15] ring-4 ring-[#DCE5D3]'
                    : 'border-[#DCE5D3] bg-[#FBF3DC]/75 text-[#2D3B22] hover:bg-[#FBF3DC]'
                }`}
              >
                {speakingKey === 'word' && speakingPhase === 'loading' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 text-[#FACC15] animate-spin" aria-hidden="true" />
                    <span>انتظر</span>
                  </>
                ) : (
                  <>
                    <Volume2
                      className={`h-3.5 w-3.5 ${
                        speakingKey === 'word' ? 'text-[#FACC15] animate-pulse' : 'text-[#9A6F14]'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{speakingKey === 'word' ? 'Playing' : 'استمع'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Centered Clean Arabic Word Target */}
          <div
            dir="rtl"
            lang="ar"
            className="flex-1 flex flex-col items-center justify-center py-4 text-center select-text"
          >
            <p
              className={`font-arabic-scheherazade font-bold text-[#1F2718] leading-[1.85] ${
                large ? 'text-5xl sm:text-6xl' : 'text-5xl'
              }`}
            >
              {card.hasCustomEdits
                ? card.wordWithTashkeel
                : applySmartPartialTashkeel(card.wordWithTashkeel)}
            </p>

            {(wordType || root) && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 font-arabic-cairo">
                {wordType && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#BBD0AA] bg-[#EEF2E9] px-3 py-1 text-xs font-bold tracking-wide text-[#2D3B22] shadow-2xs">
                    <span className="text-[#4A5A3E] font-bold">نوع الكلمة:</span>
                    <span className="font-extrabold">{wordType}</span>
                  </span>
                )}
                {root && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#FACC15]/55 bg-[#FEF9C3]/65 px-3 py-1 text-xs font-bold tracking-wide text-[#1F2718] shadow-2xs">
                    <span className="text-[#7A5B10] font-extrabold">الجذر:</span>
                    <span className="font-mono tracking-widest font-extrabold text-[#2D3B22]">{root}</span>
                  </span>
                )}
              </div>
            )}

            {card.transliteration && (
              <p className="mt-2.5 font-mono text-xs text-[#5A6552]" dir="ltr">
                {card.transliteration}
              </p>
            )}
          </div>

          {/* Front Bottom Footer: Tap to Flip + In-Card Card-to-Card Navigation */}
          <div className="shrink-0 flex items-center justify-between gap-2 border-t border-[#DCE5D3]/80 pt-3 text-xs text-[#5A6552] select-none">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[#3B4D2B] truncate">{card.partOfSpeech}</span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#2D3B22] px-2.5 py-1 text-[11px] font-semibold text-white">
                <RotateCw className="h-3 w-3 text-[#FACC15]" aria-hidden="true" />
                <span>Tap to flip</span>
              </span>
            </div>

            {renderInlineCardNav()}
          </div>
        </div>

        {/* BACK SIDE: Meaning, English Translation & Arabic Context Examples + Pinned SRS Footer */}
        <div
          dir="ltr"
          className={`backface-hidden rotate-y-180 absolute inset-0 flex flex-col rounded-2xl border border-[#3B4D2B]/35 bg-gradient-to-br from-white via-[#FAFBF8] to-[#EEF2E9] p-4 sm:p-6 shadow-sm overflow-hidden ${
            isFlipped ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          {/* Fixed Back Header */}
          <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[#DCE5D3] pb-2.5 select-none">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#4A5543] min-w-0">
              <span className="rounded-lg border border-[#CDE0C4] bg-[#EEF2E9] px-2 py-0.5 font-bold text-[#2D3B22]">
                {card.partOfSpeech}
              </span>
              {card.transliteration && (
                <span className="font-mono text-[11px] font-medium text-[#5A6552] truncate select-text">
                  {card.transliteration}
                </span>
              )}
              {card.level && (
                <span className="hidden sm:inline font-semibold text-[#9A6F14]">
                  · {LEVEL_LABELS[card.level].en}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {renderInlineCardNav(true)}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleFlip();
                }}
                aria-label="Flip back to Arabic front"
                className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white px-2.5 text-[11px] font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer touch-manipulation"
              >
                <RotateCw className="h-3 w-3 text-[#FACC15]" aria-hidden="true" />
                <span>Front</span>
              </button>
            </div>
          </div>

          {/* Scrollable Back Content (smooth touch-pan-y scrolling on long examples) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y py-3 pr-1 space-y-3.5">
            {/* English Meaning & Audio */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#3B4D2B]">
                  English Meaning
                </p>
                {onSpeakTranslation && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSpeakTranslation(card);
                    }}
                    aria-label={`Listen to English translation for ${card.wordWithTashkeel}`}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer touch-manipulation ${
                      isSpeakingTranslation
                        ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FACC15] ring-2 ring-[#DCE5D3]'
                        : 'border-[#DCE5D3] bg-white text-[#2D3B22] hover:bg-[#EEF2E9]'
                    }`}
                  >
                    <Volume2
                      className={`h-3.5 w-3.5 ${
                        isSpeakingTranslation ? 'text-[#FACC15] animate-pulse' : 'text-[#9A6F14]'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{isSpeakingTranslation ? 'Playing' : 'Listen EN'}</span>
                  </button>
                )}
              </div>
              <h3
                className={`font-display font-bold text-[#1F2718] leading-snug select-text ${
                  large ? 'text-2xl' : 'text-xl'
                }`}
              >
                {card.englishMeaning}
              </h3>

              {cardTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {cardTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#FACC15]/55 bg-[#FEF9C3]/65 px-2 py-0.5 text-[11px] font-semibold text-[#2D3B22]"
                    >
                      <Tag className="h-2.5 w-2.5 text-[#9A6F14]" aria-hidden="true" />
                      <span>{tag}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Arabic Contextual Examples + English Translation Underneath */}
            {card.examples.length > 0 && (
              <div className="space-y-2.5 border-t border-[#DCE5D3] pt-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#3B4D2B]">
                  Arabic Examples in Context
                </p>
                {card.examples.slice(0, 3).map((ex, idx) => {
                  const isPlayingSentence = speakingKey === idx;
                  return (
                    <div
                      key={idx}
                      className="rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-[#1F2718] space-y-1.5 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-[#FEF9C3]/80 border border-[#FACC15]/40 px-2 py-0.5 font-mono text-[11px] font-bold text-[#2D3B22]">
                            Example {idx + 1}
                          </span>
                          {ex.contextLabel && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#3B4D2B]">
                              {ex.contextLabel}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleSpeak(e, ex.arabic, idx)}
                          aria-busy={isPlayingSentence && speakingPhase === 'loading'}
                          aria-label={`Listen to Arabic sentence ${idx + 1}`}
                          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all cursor-pointer touch-manipulation ${
                            isPlayingSentence
                              ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FACC15] ring-2 ring-[#DCE5D3]'
                              : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#2D3B22] hover:bg-[#FBF3DC]'
                          }`}
                        >
                          {isPlayingSentence && speakingPhase === 'loading' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Volume2
                              className={`h-3.5 w-3.5 ${isPlayingSentence ? 'animate-pulse' : ''}`}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </div>
                      <p
                        className="font-arabic-scheherazade text-xl sm:text-[21px] leading-[1.95] text-[#1F2718] text-right pt-0.5 select-text"
                        dir="rtl"
                        lang="ar"
                      >
                        {card.hasCustomEdits ? ex.arabic : applySmartPartialTashkeel(ex.arabic)}
                      </p>
                      <p
                        className="text-xs sm:text-[13px] text-[#4A5543] font-medium leading-relaxed border-t border-[#EEF2E9] pt-1.5 select-text"
                        dir="ltr"
                      >
                        {ex.english}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

          </div>

          {/* Subtle, non-intrusive Remove row separated right above the SRS footer */}
          {onDelete && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 flex items-center justify-between gap-2 border-t border-[#DCE5D3]/80 pt-2 pb-1.5 select-none"
            >
              <span className="text-[11px] font-medium text-[#5A6552]">
                {card.status === 'learned' ? 'Status: Learned' : 'Status: Needs Review'}
              </span>
              <button
                type="button"
                onClick={handleRemove}
                aria-label={`Remove ${card.wordWithTashkeel} from vocabulary`}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-[#6B7861] hover:bg-[#FEF2E8] hover:text-[#C2410C] transition-colors cursor-pointer touch-manipulation whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Remove</span>
              </button>
            </div>
          )}

          {/* Pinned Compact SRS Rating Footer Bar (Always visible on mobile back face) */}
          {onRateSrs && (
            <div
              onClick={(e) => e.stopPropagation()}
              className={`shrink-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 border-t border-[#DCE5D3] bg-[#FAFBF8]/95 backdrop-blur-xs px-3 sm:px-5 py-2.5 rounded-b-2xl select-none ${
                onDelete ? '' : 'mt-1'
              }`}
            >
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Rate recall difficulty">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRateSrs(card.id, 'hard');
                  }}
                  className={`flex min-h-[44px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 transition-all cursor-pointer touch-manipulation active:scale-[0.98] ${
                    card.srsRating === 'hard'
                      ? 'border-[#C2410C] bg-[#FEF2E8] text-[#9A3412] ring-2 ring-[#C2410C]/25'
                      : 'border-orange-200 bg-[#FEF2E8]/85 text-[#9A3412] hover:bg-orange-100/80'
                  }`}
                >
                  <span className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold leading-none">
                    <Flame className="h-3.5 w-3.5 text-[#C2410C]" aria-hidden="true" />
                    <span className="font-arabic-cairo">صعب</span>
                  </span>
                  <span className="mt-0.5 text-[10px] font-semibold text-[#C2410C]/90 leading-none">
                    Hard · Soon
                  </span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRateSrs(card.id, 'good');
                  }}
                  className={`flex min-h-[44px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 transition-all cursor-pointer touch-manipulation active:scale-[0.98] ${
                    card.srsRating === 'good'
                      ? 'border-[#2D3B22] bg-[#FEF08A]/85 text-[#2D3B22] ring-2 ring-[#FACC15]/50'
                      : 'border-[#FACC15]/75 bg-[#FEF9C3]/80 text-[#2D3B22] hover:bg-[#FEF08A]/80'
                  }`}
                >
                  <span className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold leading-none">
                    <Clock className="h-3.5 w-3.5 text-[#9A6F14]" aria-hidden="true" />
                    <span className="font-arabic-cairo">جيد</span>
                  </span>
                  <span className="mt-0.5 text-[10px] font-semibold text-[#7A5B10] leading-none">
                    Good · 2d
                  </span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRateSrs(card.id, 'easy');
                  }}
                  className={`flex min-h-[44px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 transition-all cursor-pointer touch-manipulation active:scale-[0.98] ${
                    card.srsRating === 'easy'
                      ? 'border-[#FACC15] bg-[linear-gradient(180deg,#3B4D2B_0%,#2D3B22_100%)] text-white ring-2 ring-[#FACC15]/55'
                      : 'border-[#2D3B22] bg-[linear-gradient(180deg,#3B4D2B_0%,#2D3B22_100%)] text-white hover:brightness-110'
                  }`}
                >
                  <span className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold leading-none">
                    <Sparkles className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
                    <span className="font-arabic-cairo">سهل</span>
                  </span>
                  <span className="mt-0.5 text-[10px] font-semibold text-[#FEF08A] leading-none">
                    Easy · 7d
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
