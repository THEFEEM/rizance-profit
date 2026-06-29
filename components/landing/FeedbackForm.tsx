"use client";

import { useState } from "react";

const FEEDBACK_EMAIL = "lutfee7890@gmail.com";

export function FeedbackForm() {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = `ฟีดแบ็ก Rizance${rating ? ` (${rating}★)` : ""}`;
    const meta = [
      name ? `ชื่อ: ${name}` : "",
      rating ? `คะแนน: ${rating}/5` : "",
    ].filter(Boolean);
    const body = [...meta, meta.length ? "" : "", comment].join("\n");
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  }

  return (
    <form className="fb-card" onSubmit={handleSubmit}>
      <h3>ส่งรีวิว / ฟีดแบ็ก</h3>
      <p className="fb-sub">เล่าให้ฟังว่าใช้แล้วเป็นยังไง หรืออยากได้อะไรเพิ่ม</p>

      <label className="fb-label" htmlFor="fb-name">ชื่อ</label>
      <input
        id="fb-name"
        className="fb-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ชื่อของคุณ"
      />

      <label className="fb-label">ให้คะแนน</label>
      <div className="fb-stars" role="radiogroup" aria-label="ให้คะแนน">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            type="button"
            key={n}
            className={`fb-star${n <= (hover || rating) ? " on" : ""}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} ดาว`}
            aria-pressed={n === rating}
          >
            ★
          </button>
        ))}
      </div>

      <label className="fb-label" htmlFor="fb-comment">ความคิดเห็น</label>
      <textarea
        id="fb-comment"
        className="fb-textarea"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="พิมพ์รีวิวหรือฟีดแบ็กที่นี่..."
      />

      <button type="submit" className="btn btn-green fb-submit">ส่งฟีดแบ็ก</button>
    </form>
  );
}
