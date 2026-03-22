import { useState, useRef, useEffect, useCallback } from "react";
import { writeFileContent, sshWriteFile } from "../api/git";

interface UseFileEditorOptions {
	sessionId: string;
	projectId: string;
	filePath: string;
	initialContent: string;
	initialMtime: number;
	isSSH: boolean;
	autoSaveDelay?: number;
}

interface UseFileEditorReturn {
	content: string;
	setContent: (value: string) => void;
	isDirty: boolean;
	isSaving: boolean;
	saveError: string | null;
	save: () => Promise<boolean>;
	lastSavedAt: number | null;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
}

const MAX_HISTORY = 200;
// Cap undo memory: allow ~20 MB total for undo stack
const MAX_UNDO_BYTES = 20 * 1024 * 1024;

export function useFileEditor(opts: UseFileEditorOptions): UseFileEditorReturn {
	const { sessionId, projectId, filePath, initialContent, initialMtime, isSSH, autoSaveDelay = 2000 } = opts;

	const [content, setContentState] = useState(initialContent);
	const [originalContent, setOriginalContent] = useState(initialContent);
	const [, setMtime] = useState(initialMtime);
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
	const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const contentRef = useRef(content);

	// Undo/redo history
	const undoStack = useRef<string[]>([]);
	const redoStack = useRef<string[]>([]);
	const lastPushTime = useRef(0);
	const [, forceUpdate] = useState(0);

	const isDirty = content !== originalContent;

	const setContent = useCallback((value: string) => {
		// Push to undo stack (debounce: batch rapid keystrokes within 300ms)
		const now = Date.now();
		if (now - lastPushTime.current > 300 || undoStack.current.length === 0) {
			undoStack.current.push(contentRef.current);
			// Enforce both count and memory limits
			const maxEntries = Math.max(10, Math.min(MAX_HISTORY, Math.floor(MAX_UNDO_BYTES / Math.max(1, contentRef.current.length))));
			while (undoStack.current.length > maxEntries) {
				undoStack.current.shift();
			}
			lastPushTime.current = now;
		}
		// Clear redo stack on new edit
		redoStack.current = [];

		setContentState(value);
		contentRef.current = value;
		setSaveError(null);
		forceUpdate((n) => n + 1);
	}, []);

	const undo = useCallback(() => {
		if (undoStack.current.length === 0) return;
		const prev = undoStack.current.pop()!;
		redoStack.current.push(contentRef.current);
		setContentState(prev);
		contentRef.current = prev;
		forceUpdate((n) => n + 1);
	}, []);

	const redo = useCallback(() => {
		if (redoStack.current.length === 0) return;
		const next = redoStack.current.pop()!;
		undoStack.current.push(contentRef.current);
		setContentState(next);
		contentRef.current = next;
		forceUpdate((n) => n + 1);
	}, []);

	// Reset state when file changes
	useEffect(() => {
		setContentState(initialContent);
		setOriginalContent(initialContent);
		setMtime(initialMtime);
		contentRef.current = initialContent;
		undoStack.current = [];
		redoStack.current = [];
		setSaveError(null);
		setLastSavedAt(null);
	}, [filePath, initialContent, initialMtime]);

	const doSave = useCallback(async (): Promise<boolean> => {
		const currentContent = contentRef.current;
		if (currentContent === originalContent) return true;

		setIsSaving(true);
		setSaveError(null);
		try {
			if (isSSH) {
				await sshWriteFile(sessionId, filePath, currentContent);
			} else {
				const newMtime = await writeFileContent(sessionId, projectId, filePath, currentContent);
				setMtime(newMtime);
			}
			setOriginalContent(currentContent);
			setLastSavedAt(Date.now());
			return true;
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : String(err));
			return false;
		} finally {
			setIsSaving(false);
		}
	}, [sessionId, projectId, filePath, isSSH, originalContent]);

	// Immediate save (Cmd+S) — returns true if save succeeded or was unnecessary
	const save = useCallback(async (): Promise<boolean> => {
		if (autoSaveTimer.current) {
			clearTimeout(autoSaveTimer.current);
			autoSaveTimer.current = null;
		}
		return doSave();
	}, [doSave]);

	// Auto-save with debounce
	useEffect(() => {
		if (content === originalContent) return;

		if (autoSaveTimer.current) {
			clearTimeout(autoSaveTimer.current);
		}
		autoSaveTimer.current = setTimeout(() => {
			doSave();
		}, autoSaveDelay);

		return () => {
			if (autoSaveTimer.current) {
				clearTimeout(autoSaveTimer.current);
			}
		};
	}, [content, originalContent, autoSaveDelay, doSave]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (autoSaveTimer.current) {
				clearTimeout(autoSaveTimer.current);
			}
		};
	}, []);

	return {
		content,
		setContent,
		isDirty,
		isSaving,
		saveError,
		save,
		lastSavedAt,
		undo,
		redo,
		canUndo: undoStack.current.length > 0,
		canRedo: redoStack.current.length > 0,
	};
}
