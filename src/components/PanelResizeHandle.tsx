import "../styles/components/PanelResizeHandle.css";
import { useRef, useCallback } from "react";

interface PanelResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export function PanelResizeHandle({ direction, onResize, onResizeEnd }: PanelResizeHandleProps) {
  const startRef = useRef<number | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const start = direction === "horizontal" ? e.clientX : e.clientY;
    startRef.current = start;
    let last = start;

    const cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      const current = direction === "horizontal" ? ev.clientX : ev.clientY;
      const delta = current - last;
      last = current;
      onResize(delta);
    };

    const onMouseUp = () => {
      startRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [direction, onResize, onResizeEnd]);

  return (
    <div
      className={`panel-resize-handle panel-resize-handle-${direction}`}
      onMouseDown={handleMouseDown}
    >
      <div className="panel-resize-pill" />
    </div>
  );
}
