"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Phase = "idle" | "running" | "done" | "error";

export default function Home() {
  const [concept, setConcept] = useState("BUNNY");
  const [word, setWord] = useState("BUNNY");
  const [letter, setLetter] = useState("Y");
  const [seed, setSeed] = useState(0);
  const [numIter, setNumIter] = useState(50);

  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [total, setTotal] = useState(500);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  function cleanup() {
    esRef.current?.close();
    esRef.current = null;
  }

  useEffect(() => cleanup, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    cleanup();
    setPhase("running");
    setStep(0);
    setTotal(500);
    setSvgContent(null);
    setErrorMsg(null);

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept, word, letter, seed, num_iter: numIter }),
    });
    const data = await res.json();

    if (!res.ok) {
      setErrorMsg(data.error ?? "Failed to start job");
      setPhase("error");
      return;
    }

    const jobId: string = data.job_id;

    const es = new EventSource(`/api/status/${jobId}`);
    esRef.current = es;

    es.onmessage = async (ev) => {
      const payload = JSON.parse(ev.data) as {
        step: number;
        total: number;
        status: string;
      };
      setStep(payload.step);
      setTotal(payload.total);

      if (payload.status === "done") {
        es.close();
        const svgRes = await fetch(`/api/result/${jobId}`);
        if (svgRes.ok) {
          const text = await svgRes.text();
          setSvgContent(text);
          setPhase("done");
        } else {
          setErrorMsg("Generation finished but SVG could not be loaded.");
          setPhase("error");
        }
      } else if (payload.status === "error") {
        es.close();
        setErrorMsg("Generation failed. Check the terminal running server.py for details.");
        setPhase("error");
      }
    };

    es.onerror = () => {
      es.close();
      setErrorMsg("Lost connection to server.");
      setPhase("error");
    };
  }

  const pct = total > 0 ? Math.round((step / total) * 100) : 0;

  function downloadSvg() {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${word}_${letter}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center py-16 px-4">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Word-As-Image</h1>
      <p className="text-neutral-400 mb-10 text-sm">
        Deform a single letter to visually convey a semantic concept
      </p>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-neutral-900 rounded-2xl p-8 flex flex-col gap-5 shadow-xl"
      >
        <Field
          label="Semantic Concept"
          hint="e.g. BUNNY"
          value={concept}
          onChange={(v) => setConcept(v.toUpperCase())}
        />
        <Field
          label="Word to Render"
          hint="must contain the letter below"
          value={word}
          onChange={(v) => setWord(v.toUpperCase())}
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
            Letter to Deform
          </label>
          <input
            type="text"
            maxLength={1}
            value={letter}
            onChange={(e) => setLetter(e.target.value.toUpperCase())}
            className="bg-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 outline-none focus:ring-2 focus:ring-indigo-500 w-16 text-center text-lg font-mono"
            required
          />
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
              Seed
            </label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="bg-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 outline-none focus:ring-2 focus:ring-indigo-500 w-28"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
              Steps
              <span className="ml-2 normal-case font-normal text-neutral-600">— 50 for test, 500 full</span>
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={numIter}
              onChange={(e) => setNumIter(Number(e.target.value))}
              className="bg-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 outline-none focus:ring-2 focus:ring-indigo-500 w-28"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={phase === "running"}
          className="mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 transition-colors"
        >
          {phase === "running" ? "Generating…" : "Generate"}
        </button>
      </form>

      {(phase === "running" || phase === "done") && (
        <div className="mt-10 w-full max-w-md">
          <div className="flex justify-between text-sm text-neutral-400 mb-2">
            <span>Progress</span>
            <span>
              {step} / {total}&nbsp;({pct}%)
            </span>
          </div>
          <div className="h-3 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {phase === "error" && errorMsg && (
        <div className="mt-8 w-full max-w-md bg-red-950 border border-red-700 rounded-xl px-6 py-4 text-red-300 text-sm">
          {errorMsg}
        </div>
      )}

      {phase === "done" && svgContent && (
        <div className="mt-10 w-full max-w-lg flex flex-col items-center gap-4">
          <div
            className="bg-white rounded-2xl p-6 w-full flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
          <button
            onClick={downloadSvg}
            className="text-indigo-400 hover:text-indigo-300 text-sm underline"
          >
            Download SVG
          </button>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
        {label}
        {hint && (
          <span className="ml-2 normal-case font-normal text-neutral-600">
            — {hint}
          </span>
        )}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-neutral-800 rounded-lg px-4 py-2.5 text-neutral-100 placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-indigo-500"
        required
      />
    </div>
  );
}
