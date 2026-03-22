import "../styles/components/FindReplaceBar.css";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";

export interface FindMatch {
	start: number;
	end: number;
	isCurrent: boolean;
}

interface FindReplaceBarProps {
	content: string;
	onReplace: (newContent: string) => void;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	onClose: () => void;
	focusTrigger?: number;
	onMatchesChange?: (matches: FindMatch[]) => void;
	initialShowReplace?: boolean;
}

export function FindReplaceBar({ content, onReplace, textareaRef, onClose, focusTrigger, onMatchesChange, initialShowReplace }: FindReplaceBarProps) {
	const [query, setQuery] = useState("");
	const [replaceText, setReplaceText] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [currentMatch, setCurrentMatch] = useState(0);
	const [showReplace, setShowReplace] = useState(initialShowReplace ?? false);
	const searchRef = useRef<HTMLInputElement>(null);

	// Sync replace visibility when parent changes it (Cmd+F vs Cmd+R)
	useEffect(() => {
		if (initialShowReplace !== undefined) {
			setShowReplace(initialShowReplace);
		}
	}, [initialShowReplace, focusTrigger]);

	useEffect(() => {
		searchRef.current?.focus();
		searchRef.current?.select();
	}, [focusTrigger]);

	const matches = useMemo((): number[] => {
		if (!query) return [];
		const positions: number[] = [];
		const searchContent = caseSensitive ? content : content.toLowerCase();
		const searchQuery = caseSensitive ? query : query.toLowerCase();
		let idx = 0;
		while (idx < searchContent.length) {
			const found = searchContent.indexOf(searchQuery, idx);
			if (found === -1) break;
			positions.push(found);
			idx = found + 1;
		}
		return positions;
	}, [content, query, caseSensitive]);
	const matchCount = matches.length;

	const selectMatch = useCallback((index: number) => {
		if (matches.length === 0 || !textareaRef.current) return;
		const pos = matches[index];
		const textarea = textareaRef.current;
		// Scroll the match into view without stealing focus
		const linesBefore = content.substring(0, pos).split("\n").length - 1;
		const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 18;
		textarea.scrollTop = Math.max(0, linesBefore * lineHeight - textarea.clientHeight / 2);
	}, [matches, content, textareaRef]);

	const goNext = useCallback(() => {
		if (matchCount === 0) return;
		const next = (currentMatch + 1) % matchCount;
		setCurrentMatch(next);
		selectMatch(next);
	}, [currentMatch, matchCount, selectMatch]);

	const goPrev = useCallback(() => {
		if (matchCount === 0) return;
		const prev = (currentMatch - 1 + matchCount) % matchCount;
		setCurrentMatch(prev);
		selectMatch(prev);
	}, [currentMatch, matchCount, selectMatch]);

	// Auto-select first match when query changes
	useEffect(() => {
		setCurrentMatch(0);
		if (matches.length > 0) {
			selectMatch(0);
		}
	}, [query, caseSensitive]); // eslint-disable-line react-hooks/exhaustive-deps

	// Report matches to parent for highlight overlay
	useEffect(() => {
		if (!onMatchesChange) return;
		if (!query || matches.length === 0) {
			onMatchesChange([]);
			return;
		}
		onMatchesChange(
			matches.map((pos, i) => ({
				start: pos,
				end: pos + query.length,
				isCurrent: i === currentMatch,
			}))
		);
	}, [matches, currentMatch, query, onMatchesChange]);

	const replaceOne = useCallback(() => {
		if (matchCount === 0 || currentMatch >= matches.length) return;
		const pos = matches[currentMatch];
		const before = content.substring(0, pos);
		const after = content.substring(pos + query.length);
		const newContent = before + replaceText + after;
		setCurrentMatch(0);
		onReplace(newContent);
	}, [content, matches, currentMatch, query, replaceText, matchCount, onReplace]);

	const replaceAll = useCallback(() => {
		if (!query) return;
		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const flags = caseSensitive ? "g" : "gi";
		const newContent = content.replace(new RegExp(escaped, flags), replaceText);
		setCurrentMatch(0);
		onReplace(newContent);
	}, [content, query, replaceText, caseSensitive, onReplace]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			onClose();
		} else if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			goNext();
			searchRef.current?.focus();
		} else if (e.key === "Enter" && e.shiftKey) {
			e.preventDefault();
			goPrev();
			searchRef.current?.focus();
		}
	};

	return (
		<div className="find-replace-bar" onKeyDown={handleKeyDown}>
			<div className="find-replace-row">
				<input
					ref={searchRef}
					className="find-replace-input"
					placeholder="Find"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					autoComplete="off"
					spellCheck={false}
				/>
				<span className="find-replace-count">
					{query ? `${matchCount > 0 ? currentMatch + 1 : 0} of ${matchCount}` : ""}
				</span>
				<button className="find-replace-btn" onClick={() => { goPrev(); searchRef.current?.focus(); }} disabled={matchCount === 0} title="Previous (Shift+Enter)">&#x2191;</button>
				<button className="find-replace-btn" onClick={() => { goNext(); searchRef.current?.focus(); }} disabled={matchCount === 0} title="Next (Enter)">&#x2193;</button>
				<button
					className={`find-replace-btn find-replace-toggle ${caseSensitive ? "active" : ""}`}
					onClick={() => setCaseSensitive(!caseSensitive)}
					title="Case sensitive"
				>
					Aa
				</button>
				<button
					className={`find-replace-btn find-replace-toggle ${showReplace ? "active" : ""}`}
					onClick={() => setShowReplace(!showReplace)}
					title="Toggle replace"
				>
					&#x21C4;
				</button>
				<button className="find-replace-btn find-replace-close" onClick={onClose} title="Close (Esc)">&times;</button>
			</div>
			{showReplace && (
				<div className="find-replace-row">
					<input
						className="find-replace-input"
						placeholder="Replace"
						value={replaceText}
						onChange={(e) => setReplaceText(e.target.value)}
						autoComplete="off"
						spellCheck={false}
					/>
					<button className="find-replace-btn" onClick={replaceOne} disabled={matchCount === 0} title="Replace">Replace</button>
					<button className="find-replace-btn" onClick={replaceAll} disabled={matchCount === 0} title="Replace all">All</button>
				</div>
			)}
		</div>
	);
}
