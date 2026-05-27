import glob
import json
import os
import re
import subprocess
import sys
import threading
import uuid
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

REPO_ROOT = Path(__file__).parent.resolve()
EXPERIMENT = "conformal_0.5_dist_pixel_100_kernel201"
FONT = "NeutralStd-Medium"
TOTAL_STEPS = 500

jobs: dict[str, dict] = {}


def _watch_stderr(job_id: str, proc: subprocess.Popen) -> None:
    pattern = re.compile(r"(\d+)/(\d+)")
    for line in proc.stderr:
        m = pattern.search(line)
        if m:
            step, total = int(m.group(1)), int(m.group(2))
            jobs[job_id]["step"] = step
            jobs[job_id]["total"] = total

    proc.wait()
    job = jobs[job_id]
    if proc.returncode == 0:
        word = job["word"]
        letter = job["letter"]
        concept = job["concept"]
        seed = job["seed"]
        # Find output SVG — try specific path first, then glob
        candidate = (
            REPO_ROOT
            / "output"
            / f"{EXPERIMENT}_{word}"
            / FONT
            / f"{letter}_concept_{concept}_seed_{seed}"
            / "output-svg"
            / "output.svg"
        )
        if candidate.exists():
            job["svg_path"] = str(candidate)
        else:
            matches = glob.glob(
                str(REPO_ROOT / "output" / "**" / "*.svg"), recursive=True
            )
            job["svg_path"] = matches[0] if matches else None
        job["status"] = "done"
    else:
        job["status"] = "error"


@app.post("/api/generate")
def generate():
    body = request.get_json(force=True)
    concept = body.get("concept", "").strip().upper()
    word = body.get("word", "").strip().upper()
    letter = body.get("letter", "").strip().upper()
    seed = int(body.get("seed", 0))

    if not concept or not word or not letter:
        return jsonify(error="concept, word and letter are required"), 400
    if letter not in word:
        return jsonify(error=f"'{letter}' must appear in '{word}'"), 400

    job_id = str(uuid.uuid4())
    cmd = [
        sys.executable,
        "code/main.py",
        "--experiment", EXPERIMENT,
        "--semantic_concept", concept,
        "--word", word,
        "--optimized_letter", letter,
        "--font", FONT,
        "--seed", str(seed),
        "--use_wandb", "0",
    ]
    proc = subprocess.Popen(
        cmd,
        stderr=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        text=True,
        bufsize=1,
        cwd=str(REPO_ROOT),
    )

    jobs[job_id] = {
        "proc": proc,
        "step": 0,
        "total": TOTAL_STEPS,
        "status": "running",
        "svg_path": None,
        "concept": concept,
        "word": word,
        "letter": letter,
        "seed": seed,
    }

    t = threading.Thread(target=_watch_stderr, args=(job_id, proc), daemon=True)
    t.start()

    return jsonify(job_id=job_id)


@app.get("/api/status/<job_id>")
def status(job_id: str):
    if job_id not in jobs:
        return jsonify(error="unknown job"), 404

    def stream():
        import time
        while True:
            job = jobs[job_id]
            payload = json.dumps({
                "step": job["step"],
                "total": job["total"],
                "status": job["status"],
            })
            yield f"data: {payload}\n\n"
            if job["status"] in ("done", "error"):
                break
            time.sleep(0.5)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/result/<job_id>")
def result(job_id: str):
    if job_id not in jobs:
        return jsonify(error="unknown job"), 404
    job = jobs[job_id]
    if job["status"] != "done":
        return jsonify(error="not ready"), 202
    if not job["svg_path"]:
        return jsonify(error="output SVG not found"), 500
    return send_file(job["svg_path"], mimetype="image/svg+xml",
                     as_attachment=False)


if __name__ == "__main__":
    app.run(port=5000, debug=False)
