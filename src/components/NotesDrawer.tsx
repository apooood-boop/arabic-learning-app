import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Layers,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { NoteContextTag, StudyNote } from '../types/arabic';

export interface SaveNoteResult {
  ok: boolean;
  syncedToCloud?: boolean;
  message?: string;
  error?: string;
}

interface NotesDrawerProps {
  isOpen: boolean;
  notes: StudyNote[];
  activeContext: NoteContextTag | null;
  onClose: () => void;
  onSaveNote: (input: {
    id?: string;
    title?: string;
    body: string;
    context?: NoteContextTag;
  }) => Promise<SaveNoteResult> | SaveNoteResult;
  onDeleteNote: (id: string) => Promise<SaveNoteResult | void> | void;
}

function formatNoteDate(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function NotesDrawer({
  isOpen,
  notes,
  activeContext,
  onClose,
  onSaveNote,
  onDeleteNote,
}: NotesDrawerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachedContext, setAttachedContext] = useState<NoteContextTag | undefined>(
    activeContext ?? undefined
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [filterScope, setFilterScope] = useState<'all' | 'context'>('all');
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  // Sync default context when opening the drawer for a new note
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setConfirmDeleteId(null);
      if (!editingId) {
        setAttachedContext(activeContext ?? undefined);
      }
    } else {
      setFilterScope('all');
      setSuccessMessage(null);
    }
  }, [isOpen, activeContext, editingId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  );

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedNotes.filter((note) => {
      if (filterScope === 'context' && activeContext) {
        const matchesRef =
          activeContext.refId && note.context?.refId
            ? note.context.refId === activeContext.refId
            : note.context?.label === activeContext.label;
        if (!matchesRef) return false;
      }
      if (!q) return true;
      return (
        (note.title ?? '').toLowerCase().includes(q) ||
        note.body.toLowerCase().includes(q) ||
        (note.context?.label ?? '').toLowerCase().includes(q)
      );
    });
  }, [sortedNotes, searchQuery, filterScope, activeContext]);

  const contextMatchCount = useMemo(() => {
    if (!activeContext) return 0;
    return notes.filter((note) =>
      activeContext.refId && note.context?.refId
        ? note.context.refId === activeContext.refId
        : note.context?.label === activeContext.label
    ).length;
  }, [notes, activeContext]);

  if (!isOpen) return null;

  const resetComposer = () => {
    setEditingId(null);
    setTitle('');
    setBody('');
    setAttachedContext(activeContext ?? undefined);
    setError(null);
  };

  const handleStartEdit = (note: StudyNote) => {
    setEditingId(note.id);
    setTitle(note.title ?? '');
    setBody(note.body);
    setAttachedContext(note.context);
    setError(null);
    setConfirmDeleteId(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const cleanBody = body.trim();
    const cleanTitle = title.trim();
    if (!cleanBody) {
      setSuccessMessage(null);
      setError('Please write your note before saving · يرجى كتابة الملاحظة قبل الحفظ.');
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsSaving(true);

    try {
      const result = await onSaveNote({
        id: editingId ?? undefined,
        title: cleanTitle || undefined,
        body: cleanBody,
        context: attachedContext,
      });

      if (!result.ok) {
        setError(
          result.error ||
            'Failed to save note. Please try again · تعذر حفظ الملاحظة، يرجى المحاولة مرة أخرى.'
        );
        return;
      }

      resetComposer();
      const message =
        result.message ||
        (result.syncedToCloud
          ? 'Saved to cloud · تم الحفظ في السحابة'
          : 'Saved · تم الحفظ');
      setSuccessMessage(message);

      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = window.setTimeout(() => {
        setSuccessMessage(null);
        savedTimerRef.current = null;
      }, 3500);
    } catch (err) {
      console.error('[Qalam NotesDrawer] Failed to save note:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Unexpected error while saving note · حدث خطأ غير متوقع أثناء الحفظ.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch justify-end bg-[#182111]/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="flex h-[92dvh] sm:h-full w-full max-w-lg flex-col rounded-t-3xl sm:rounded-none border-t sm:border-t-0 sm:border-l border-[#DCE5D3] bg-[#FAFBF8] shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex sm:hidden justify-center pt-2 pb-0.5 shrink-0" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-[#DCE5D3]" />
        </div>

        {/* Drawer Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#DCE5D3] bg-white px-4 sm:px-5 py-3.5 sm:py-4 shrink-0 rounded-t-3xl sm:rounded-none">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#E8B948] shadow-2xs">
              <NotebookPen className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h2
                  id="notes-drawer-title"
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-cairo text-xl font-bold text-[#2D3B22] leading-none"
                >
                  ملاحظاتي
                </h2>
                <span className="font-display text-base font-bold text-[#1F2718]">
                  My Notes
                </span>
                <span className="font-mono text-xs font-semibold text-[#9A6F14] tabular-nums">
                  ({notes.length})
                </span>
              </div>
              <p className="text-[11px] text-[#5A6552] mt-0.5 truncate">
                Personal study notes saved automatically across all lessons &amp; flashcards
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close My Notes"
            className="inline-flex h-10 w-10 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#1F2718] transition-colors cursor-pointer touch-manipulation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-5">
          {/* Note Composer Form */}
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-[#DCE5D3] bg-white p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#1F2718]">
                {editingId ? 'Edit Note · تعديل الملاحظة' : 'New Study Note · ملاحظة جديدة'}
              </span>
            </div>

            {successMessage && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-xl border border-[#C6D9B7] bg-[#EEF5E8] px-3 py-2 text-xs font-semibold text-[#244316]"
              >
                <Check className="h-4 w-4 shrink-0 text-[#3E7A25]" aria-hidden="true" />
                <span>{successMessage}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-orange-300 bg-[#FEF2E8] px-3 py-2 text-xs font-medium text-[#9A3412]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C2410C]" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Context Attachment Row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {attachedContext ? (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCE5D3] bg-[#EEF2E9] px-2.5 py-1 text-[11px] font-semibold text-[#2D3B22] max-w-full">
                  {attachedContext.type === 'lesson' ? (
                    <BookOpen className="h-3 w-3 shrink-0 text-[#9A6F14]" aria-hidden="true" />
                  ) : (
                    <Layers className="h-3 w-3 shrink-0 text-[#9A6F14]" aria-hidden="true" />
                  )}
                  <span dir="auto" className="truncate max-w-[260px]">
                    {attachedContext.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedContext(undefined)}
                    title="Remove context tag"
                    aria-label="Remove context tag"
                    className="ml-0.5 rounded p-0.5 text-[#5A6552] hover:bg-[#DCE5D3] hover:text-[#1F2718] cursor-pointer"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#5A6552]">
                    <Tag className="h-3 w-3" aria-hidden="true" />
                    <span>General note (no tag)</span>
                  </span>
                  {activeContext && (
                    <button
                      type="button"
                      onClick={() => setAttachedContext(activeContext)}
                      className="text-[11px] font-semibold text-[#9A6F14] hover:underline cursor-pointer"
                    >
                      + Attach current context
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Optional Title */}
            <div>
              <label htmlFor="study-note-title" className="sr-only">
                Note Title (Optional)
              </label>
              <input
                id="study-note-title"
                type="text"
                dir="auto"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="عنوان الملاحظة (اختياري) · Title (optional)"
                className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3.5 py-2.5 sm:py-2 text-base sm:text-sm font-medium text-[#1F2718] placeholder:text-[#6B7861] focus:border-[#2D3B22] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
              />
            </div>

            {/* Required Body */}
            <div>
              <label htmlFor="study-note-body" className="sr-only">
                Study Note Content
              </label>
              <textarea
                id="study-note-body"
                rows={4}
                dir="auto"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="اكتب ملاحظاتك، القواعد النحوية، أو معاني الكلمات هنا... Write your study note here..."
                className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3.5 py-2.5 text-base sm:text-sm leading-relaxed text-[#1F2718] placeholder:text-[#6B7861] focus:border-[#D4A338] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4A338]/20"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {editingId && (
                <button
                  type="button"
                  onClick={resetComposer}
                  className="min-h-[44px] sm:min-h-0 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 text-xs font-semibold text-[#5A6552] hover:bg-[#EEF2E9] transition-colors cursor-pointer touch-manipulation"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1.5 rounded-xl bg-[#2D3B22] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3E522D] disabled:opacity-60 disabled:cursor-not-allowed shadow-2xs transition-colors cursor-pointer touch-manipulation"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E8B948]" aria-hidden="true" />
                    <span>Saving... · جارٍ الحفظ...</span>
                  </>
                ) : editingId ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
                    <span>Update Note · تحديث</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
                    <span>Save Note · حفظ الملاحظة</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Search & Context Filter */}
          {notes.length > 0 && (
            <div className="space-y-2.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7861]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  dir="auto"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث في ملاحظاتك... Search saved notes"
                  className="w-full rounded-xl border border-[#DCE5D3] bg-white pl-9 pr-3.5 py-2.5 sm:py-2 text-base sm:text-xs text-[#1F2718] placeholder:text-[#6B7861] focus:border-[#2D3B22] focus:outline-none"
                />
              </div>

              {activeContext && contextMatchCount > 0 && (
                <div className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setFilterScope('all')}
                    className={`rounded-lg px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      filterScope === 'all'
                        ? 'bg-[#2D3B22] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    All Notes ({notes.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterScope('context')}
                    className={`rounded-lg px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      filterScope === 'context'
                        ? 'bg-[#D4A338] text-[#1F2718]'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    This Context ({contextMatchCount})
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Saved Notes List */}
          {notes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#DCE5D3] bg-white/80 px-5 py-10 text-center space-y-2">
              <p
                dir="rtl"
                lang="ar"
                className="font-arabic-cairo text-xl font-bold text-[#2D3B22]"
              >
                لا توجد ملاحظات محفوظة بعد
              </p>
              <p className="text-xs text-[#5A6552] max-w-xs mx-auto leading-relaxed">
                Jot down Arabic grammar reminders, vocabulary nuances, or personal study thoughts
                anytime—your notes stay saved automatically.
              </p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="rounded-2xl border border-[#DCE5D3] bg-white px-5 py-8 text-center text-xs text-[#5A6552]">
              No notes match &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredNotes.map((note) => {
                const isEditingThis = editingId === note.id;
                const isConfirmingDelete = confirmDeleteId === note.id;

                return (
                  <article
                    key={note.id}
                    className={`rounded-2xl border bg-white p-4 shadow-2xs transition-colors space-y-2.5 ${
                      isEditingThis
                        ? 'border-[#2D3B22] ring-2 ring-[#2D3B22]/15'
                        : 'border-[#DCE5D3] hover:border-[#D4A338]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        {note.context && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#EEF2E9] border border-[#DCE5D3] px-2 py-0.5 text-[11px] font-semibold text-[#2D3B22] max-w-[240px]">
                            {note.context.type === 'lesson' ? (
                              <BookOpen className="h-3 w-3 shrink-0 text-[#9A6F14]" aria-hidden="true" />
                            ) : (
                              <Layers className="h-3 w-3 shrink-0 text-[#9A6F14]" aria-hidden="true" />
                            )}
                            <span dir="auto" className="truncate">
                              {note.context.label}
                            </span>
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-[#6B7861]">
                          {formatNoteDate(note.updatedAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(note)}
                          aria-label="Edit note"
                          title="Edit note"
                          className="inline-flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded-lg text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#2D3B22] transition-colors cursor-pointer touch-manipulation"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>

                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={deletingId === note.id}
                              onClick={async () => {
                                setDeletingId(note.id);
                                setError(null);
                                try {
                                  const result = await onDeleteNote(note.id);
                                  if (result && !result.ok) {
                                    setError(
                                      result.error ||
                                        'Failed to delete note from cloud · تعذر حذف الملاحظة.'
                                    );
                                  } else {
                                    if (editingId === note.id) resetComposer();
                                  }
                                } catch (err) {
                                  console.error('[Qalam NotesDrawer] Failed to delete note:', err);
                                  setError(
                                    err instanceof Error ? err.message : 'Failed to delete note.'
                                  );
                                } finally {
                                  setDeletingId(null);
                                  setConfirmDeleteId(null);
                                }
                              }}
                              className="min-h-[36px] sm:min-h-0 rounded-lg bg-[#C2410C] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#9A3412] disabled:opacity-60 cursor-pointer touch-manipulation"
                            >
                              {deletingId === note.id ? 'Deleting...' : 'Delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[36px] sm:min-h-0 rounded-lg px-2 py-1 text-[11px] font-medium text-[#5A6552] hover:bg-[#EEF2E9] cursor-pointer touch-manipulation"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(note.id)}
                            aria-label="Delete note"
                            title="Delete note"
                            className="inline-flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded-lg text-[#6B7861] hover:bg-[#FEF2E8] hover:text-[#C2410C] transition-colors cursor-pointer touch-manipulation"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>

                    {note.title && (
                      <h3
                        dir="auto"
                        className="font-display text-sm font-bold text-[#1F2718] leading-snug"
                      >
                        {note.title}
                      </h3>
                    )}

                    <p
                      dir="auto"
                      className="whitespace-pre-wrap text-sm leading-relaxed text-[#3F4A37]"
                    >
                      {note.body}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
