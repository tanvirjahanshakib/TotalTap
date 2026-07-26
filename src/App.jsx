import React, { useState, useMemo, useEffect, createContext, useContext } from "react";
import { Plus, X, ChevronLeft, Wallet, Trash2, Bell, Languages } from "lucide-react";
import { STRINGS, LANG_STORAGE_KEY } from "./strings";
import appIcon from "../resources/icon.png";

// ---- helpers ----
function safeEval(expr) {
  if (!expr) return 0;
  // only allow digits, operators, dot, parens
  if (!/^[0-9+\-*/.() ]+$/.test(expr)) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${expr})`)();
    return typeof val === "number" && isFinite(val) ? val : NaN;
  } catch {
    return NaN;
  }
}

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return Number(n.toFixed(2)).toLocaleString("en-BD");
}

const NOTES_STORAGE_KEY = "totaltap_notes";

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function monthLabel(ts, lang) {
  const d = new Date(ts);
  return d.toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", {
    month: "long",
    year: "numeric",
  });
}

const PALETTE = {
  bg: "#14110F",
  panel: "#1E1A17",
  panelSoft: "#26211D",
  amber: "#E3A857",
  amberSoft: "#B8823E",
  cream: "#F2E9DD",
  dim: "#8A8078",
  danger: "#C1553F",
};

const KEYS = [
  ["C", "⌫", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ".", "="],
];

function keyToOp(k) {
  return { "÷": "/", "×": "*", "−": "-" }[k] || k;
}

// ---- i18n context ----
const LangContext = createContext(null);
function useLang() {
  return useContext(LangContext);
}

function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(LANG_STORAGE_KEY) === "en" ? "en" : "bn";
    } catch {
      return "bn";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore storage errors (private mode etc.)
    }
  }, [lang]);

  const toggleLang = () => setLang((l) => (l === "bn" ? "en" : "bn"));
  const t = STRINGS[lang];

  return (
    <LangContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export default function App() {
  return (
    <LangProvider>
      <ChaHisab />
    </LangProvider>
  );
}

function ChaHisab() {
  const { lang, t } = useLang();
  const [display, setDisplay] = useState("0");
  const [expr, setExpr] = useState("");
  const [notes, setNotes] = useState(loadNotes); // {id, name, entries:[{amount, ts}]}
  const [view, setView] = useState("calc"); // calc | notes | noteDetail | notifications
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [addingNote, setAddingNote] = useState(false);
  const [newNoteName, setNewNoteName] = useState("");
  const [flash, setFlash] = useState(null);
  const [dueMode, setDueMode] = useState(false);
  const [pendingSettles, setPendingSettles] = useState([]); // [{noteId, ts, amount}] — ক্যালকুলেটরে যোগ হওয়া বাকি এন্ট্রিগুলো
  const [settlingEntry, setSettlingEntry] = useState(null); // {noteId, entry} — এমাউন্ট বাছাই মোডাল খোলা থাকলে
  const [settleAmountInput, setSettleAmountInput] = useState("");

  const activeNote = notes.find((n) => n.id === activeNoteId);

  // প্রতিবার নোট আপডেট হলে সাথে সাথে localStorage-এ সেভ হয়ে যায়,
  // তাই অ্যাপ বন্ধ করলে বা রিফ্রেশ দিলেও ডেটা মুছে যায় না।
  useEffect(() => {
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch {
      // storage unavailable (private mode etc.) — ignore, in-memory state still works
    }
  }, [notes]);

  function pressKey(raw) {
    if (raw === "C") {
      setExpr("");
      setDisplay("0");
      setPendingSettles([]);
      return;
    }
    if (raw === "⌫") {
      const next = expr.slice(0, -1);
      setExpr(next);
      setDisplay(next === "" ? "0" : next);
      return;
    }
    if (raw === "=") {
      const val = safeEval(expr);
      if (isNaN(val)) {
        setDisplay(t.wrongCalc);
        return;
      }
      setDisplay(String(val));
      setExpr(String(val));
      return;
    }
    const op = keyToOp(raw);
    const next = expr + op;
    setExpr(next);
    setDisplay(next);
  }

  function currentValue() {
    const val = safeEval(expr || display);
    return isNaN(val) ? null : val;
  }

  function addToNote(noteId) {
    const val = currentValue();
    if (val === null || val === 0) return;

    const queued = pendingSettles.filter((p) => p.noteId === noteId);
    const queuedSum = queued.reduce((s, p) => s + p.amount, 0);
    const now = Date.now();

    if (queued.length > 0) {
      // এই ক্যালকুলেশনে আগের বাকি (পুরো বা আংশিক) মেশানো আছে —
      // যতটুকু বাছাই করা হয়েছে ততটুকু পরিশোধ (paid) হবে, বাকি অংশ থাকলে সেটা এখনো "বাকি" হিসেবেই থাকবে
      const remainder = Math.max(0, val - queuedSum);
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id !== noteId) return n;
          const nextEntries = [];
          n.entries.forEach((e) => {
            const q = queued.find((p) => p.ts === e.ts);
            if (!q) {
              nextEntries.push(e);
              return;
            }
            const payAmount = Math.min(q.amount, e.amount);
            if (payAmount >= e.amount) {
              // পুরোটাই পরিশোধ
              nextEntries.push({ ...e, status: "paid", settledAt: now });
            } else {
              // আংশিক পরিশোধ — এন্ট্রিটা ভাগ হয়ে যাবে
              nextEntries.push({
                amount: payAmount,
                ts: e.ts,
                status: "paid",
                settledAt: now,
              });
              nextEntries.push({
                amount: e.amount - payAmount,
                ts: now + Math.floor(Math.random() * 900) + 1,
                status: "due",
                settledAt: null,
              });
            }
          });
          const withRemainder =
            remainder > 0
              ? [
                  ...nextEntries,
                  { amount: remainder, ts: now, status: "paid", settledAt: null },
                ]
              : nextEntries;
          return { ...n, entries: withRemainder };
        })
      );
      setPendingSettles((prev) => prev.filter((p) => p.noteId !== noteId));
    } else {
      const entry = dueMode
        ? { amount: val, ts: now, status: "due", settledAt: null }
        : { amount: val, ts: now, status: "paid", settledAt: null };
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, entries: [...n.entries, entry] } : n
        )
      );
    }

    const note = notes.find((n) => n.id === noteId);
    setFlash(note ? note.name : null);
    setTimeout(() => setFlash(null), 900);
    setExpr("");
    setDisplay("0");
    setDueMode(false);
  }

  // "পরিশোধ করুন" চাপলে প্রথমে একটা মোডাল খোলে যেখানে ইউজার বেছে নিতে পারেন কত টাকা
  // এখন পরিশোধ করবেন (পুরোটা বা আংশিক)। বাছাই করা এমাউন্টটাই তখন ক্যালকুলেটরে যোগ হয়,
  // আর নোটে অ্যাড করলে তখনই সেটুকু settle হয়ে যায়।
  function openSettleModal(note, entry) {
    setSettlingEntry({ noteId: note.id, entry });
    setSettleAmountInput(String(entry.amount));
  }

  function cancelSettleModal() {
    setSettlingEntry(null);
    setSettleAmountInput("");
  }

  function confirmSettleAmount() {
    if (!settlingEntry) return;
    const { noteId, entry } = settlingEntry;
    let chosen = parseFloat(settleAmountInput);
    if (isNaN(chosen) || chosen <= 0) return;
    if (chosen > entry.amount) chosen = entry.amount; // পুরো বাকির চেয়ে বেশি পরিশোধ করা যাবে না
    queueSettle(noteId, entry, chosen);
    setSettlingEntry(null);
    setSettleAmountInput("");
  }

  function queueSettle(noteId, entry, chosenAmount) {
    setPendingSettles((prev) => [
      ...prev,
      { noteId, ts: entry.ts, amount: chosenAmount },
    ]);
    setExpr((prev) => {
      const next = prev ? `${prev}+${chosenAmount}` : `${chosenAmount}`;
      setDisplay(next);
      return next;
    });
    setView("calc");
  }

  function cancelQueuedSettle(ts) {
    setPendingSettles((prev) => prev.filter((p) => p.ts !== ts));
  }

  function createNote() {
    const name = newNoteName.trim();
    if (!name) return;
    const id = Date.now().toString();
    setNotes((prev) => [...prev, { id, name, entries: [], seenMonths: [] }]);
    setNewNoteName("");
    setAddingNote(false);
  }

  function deleteNote(id) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (activeNoteId === id) {
      setActiveNoteId(null);
      setView("notes");
    }
  }

  function deleteEntry(noteId, ts) {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? { ...n, entries: n.entries.filter((e) => e.ts !== ts) }
          : n
      )
    );
  }

  const monthlyTotal = useMemo(() => {
    return (note) => {
      if (!note) return 0;
      const mk = monthKey(Date.now());
      return note.entries
        .filter((e) => e.status !== "due")
        .filter((e) => monthKey(e.settledAt || e.ts) === mk)
        .reduce((s, e) => s + e.amount, 0);
    };
  }, []);

  const groupedByMonth = (note) => {
    if (!note) return [];
    const map = {};
    note.entries
      .filter((e) => e.status !== "due")
      .forEach((e) => {
        const countTs = e.settledAt || e.ts;
        const k = monthKey(countTs);
        if (!map[k])
          map[k] = { key: k, label: monthLabel(countTs, lang), entries: [], total: 0 };
        map[k].entries.push(e);
        map[k].total += e.amount;
      });
    return Object.values(map).sort(
      (a, b) => b.entries[0].ts - a.entries[0].ts
    );
  };

  // যেসব এন্ট্রি এখনো "বাকি" আছে, পরিশোধ হয়নি
  const pendingDues = (note) => {
    if (!note) return [];
    return note.entries
      .filter((e) => e.status === "due")
      .slice()
      .sort((a, b) => b.ts - a.ts);
  };

  // মাস শেষ হলে যেসব নোটের আগের মাসের হিসাব এখনো "দেখা হয়নি" সেগুলোর নোটিফিকেশন লিস্ট
  const pendingNotifications = useMemo(() => {
    const currentMK = monthKey(Date.now());
    const list = [];
    notes.forEach((note) => {
      const groups = groupedByMonth(note);
      groups.forEach((g) => {
        if (g.key !== currentMK && !(note.seenMonths || []).includes(g.key)) {
          list.push({
            noteId: note.id,
            noteName: note.name,
            monthKey: g.key,
            label: g.label,
            total: g.total,
          });
        }
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, lang]);

  function dismissNotification(noteId, mKey) {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? { ...n, seenMonths: [...(n.seenMonths || []), mKey] }
          : n
      )
    );
  }

  return (
    <div
      style={{
        // Fill the entire real screen — no floating "phone inside a phone" card.
        minHeight: "100dvh",
        width: "100%",
        background: `radial-gradient(circle at 50% -10%, #241f1a 0%, ${PALETTE.bg} 55%)`,
        fontFamily:
          "'Hind Siliguri', 'Segoe UI', system-ui, -apple-system, sans-serif",
        boxSizing: "border-box",
        // Push content clear of notches / the status bar and the gesture/nav bar.
        paddingTop: "max(14px, env(safe-area-inset-top))",
        paddingBottom: "max(14px, env(safe-area-inset-bottom))",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
          position: "relative",
        }}
      >
        {view === "calc" && (
          <CalcView
            display={display}
            expr={expr}
            notes={notes}
            addToNote={addToNote}
            monthlyTotal={monthlyTotal}
            pendingDues={pendingDues}
            dueMode={dueMode}
            setDueMode={setDueMode}
            pressKey={pressKey}
            openNotes={() => setView("notes")}
            openAddNote={() => setAddingNote(true)}
            flash={flash}
            notifCount={pendingNotifications.length}
            openNotifications={() => setView("notifications")}
            pendingSettles={pendingSettles}
            cancelQueuedSettle={cancelQueuedSettle}
          />
        )}

        {view === "notes" && (
          <NotesListView
            notes={notes}
            monthlyTotal={monthlyTotal}
            onBack={() => setView("calc")}
            onOpen={(id) => {
              setActiveNoteId(id);
              setView("noteDetail");
            }}
            onAdd={() => setAddingNote(true)}
            onDelete={deleteNote}
            notifCount={pendingNotifications.length}
            openNotifications={() => setView("notifications")}
          />
        )}

        {view === "notifications" && (
          <NotificationsView
            items={pendingNotifications}
            onBack={() => setView("calc")}
            onDismiss={dismissNotification}
          />
        )}

        {view === "noteDetail" && activeNote && (
          <NoteDetailView
            note={activeNote}
            groups={groupedByMonth(activeNote)}
            monthlyTotal={monthlyTotal(activeNote)}
            dues={pendingDues(activeNote)}
            onQueueSettle={(entry) => openSettleModal(activeNote, entry)}
            onBack={() => setView("notes")}
            onDeleteEntry={(ts) => deleteEntry(activeNote.id, ts)}
          />
        )}

        {addingNote && (
          <AddNoteModal
            value={newNoteName}
            onChange={setNewNoteName}
            onCancel={() => {
              setAddingNote(false);
              setNewNoteName("");
            }}
            onCreate={createNote}
          />
        )}

        {settlingEntry && (
          <SettleAmountModal
            dueAmount={settlingEntry.entry.amount}
            value={settleAmountInput}
            onChange={setSettleAmountInput}
            onCancel={cancelSettleModal}
            onConfirm={confirmSettleAmount}
          />
        )}
      </div>
    </div>
  );
}

function LangToggle() {
  const { lang, toggleLang, t } = useLang();
  return (
    <button
      onClick={toggleLang}
      aria-label={t.langToggleAria}
      title={t.langToggleAria}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: PALETTE.panelSoft,
        border: `1px solid #3a322b`,
        color: PALETTE.amber,
        borderRadius: 999,
        padding: "5px 9px",
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Languages size={12} />
      {lang === "bn" ? "বাং / EN" : "EN / বাং"}
    </button>
  );
}

function TopBar({ title, onBack, right, showIcon }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "14px 18px 6px",
        gap: 8,
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: PALETTE.cream,
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            padding: 4,
            marginLeft: -4,
            flexShrink: 0,
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: PALETTE.cream,
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: 0.3,
          minWidth: 0,
        }}
      >
        {showIcon && (
          <img
            src={appIcon}
            alt="TotalTap"
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        {right}
        <LangToggle />
      </div>
    </div>
  );
}

function CalcView({
  display,
  expr,
  notes,
  addToNote,
  monthlyTotal,
  pendingDues,
  dueMode,
  setDueMode,
  pressKey,
  openNotes,
  openAddNote,
  flash,
  notifCount,
  openNotifications,
  pendingSettles,
  cancelQueuedSettle,
}) {
  const { t } = useLang();
  return (
    <div style={{ padding: "4px 18px 22px" }}>
      <TopBar
        title={t.appTitle}
        showIcon
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={openNotifications}
              style={{
                position: "relative",
                background: "none",
                border: "none",
                color: PALETTE.amber,
                cursor: "pointer",
                display: "flex",
              }}
              aria-label={t.notifAria}
            >
              <Bell size={19} />
              {notifCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -3,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: PALETTE.danger,
                  }}
                />
              )}
            </button>
            <button
              onClick={openNotes}
              style={{
                background: "none",
                border: "none",
                color: PALETTE.amber,
                cursor: "pointer",
                display: "flex",
              }}
              aria-label={t.notesAria}
            >
              <Wallet size={20} />
            </button>
          </div>
        }
      />

      {/* Display */}
      <div
        style={{
          marginTop: 14,
          textAlign: "right",
          padding: "18px 10px 6px",
          minHeight: 88,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        <div style={{ color: PALETTE.dim, fontSize: 14, minHeight: 18 }}>
          {expr || " "}
        </div>
        <div
          style={{
            color: PALETTE.cream,
            fontSize: 42,
            fontWeight: 300,
            fontVariantNumeric: "tabular-nums",
            wordBreak: "break-all",
          }}
        >
          {display}
        </div>
      </div>

      {pendingSettles && pendingSettles.length > 0 && (
        <div
          style={{
            background: `${PALETTE.danger}18`,
            border: `1px solid ${PALETTE.danger}55`,
            borderRadius: 14,
            padding: "10px 12px",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              color: PALETTE.danger,
              fontSize: 11.5,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {t.settlingBanner}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {pendingSettles.map((p) => (
              <div
                key={p.ts}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: PALETTE.panelSoft,
                  borderRadius: 10,
                  padding: "4px 8px",
                  fontSize: 12,
                  color: PALETTE.cream,
                }}
              >
                ৳{fmt(p.amount)} {t.due}
                <button
                  onClick={() => cancelQueuedSettle(p.ts)}
                  style={{
                    background: "none",
                    border: "none",
                    color: PALETTE.dim,
                    cursor: "pointer",
                    display: "flex",
                    padding: 0,
                  }}
                  title={t.removeQueued}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* নগদ / বাকি টগল */}
      <div
        style={{
          display: "flex",
          background: PALETTE.panelSoft,
          borderRadius: 14,
          padding: 4,
          marginBottom: 10,
        }}
      >
        <button
          onClick={() => setDueMode(false)}
          style={{
            flex: 1,
            padding: "9px 0",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            background: !dueMode
              ? `linear-gradient(180deg, ${PALETTE.amber}, ${PALETTE.amberSoft})`
              : "transparent",
            color: !dueMode ? "#1a1510" : PALETTE.dim,
            transition: "all 0.2s",
          }}
        >
          {t.cash}
        </button>
        <button
          onClick={() => setDueMode(true)}
          style={{
            flex: 1,
            padding: "9px 0",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            background: dueMode ? PALETTE.danger : "transparent",
            color: dueMode ? PALETTE.cream : PALETTE.dim,
            transition: "all 0.2s",
          }}
        >
          {t.due}
        </button>
      </div>

      {/* Note chips row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          padding: "6px 2px 16px",
        }}
      >
        <button
          onClick={openAddNote}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: PALETTE.panelSoft,
            border: `1px dashed ${PALETTE.amberSoft}`,
            color: PALETTE.amber,
            borderRadius: 20,
            padding: "8px 12px",
            fontSize: 13,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <Plus size={14} /> {t.newNote}
        </button>
        {notes.map((n) => {
          const dues = pendingDues(n);
          const dueTotal = dues.reduce((s, e) => s + e.amount, 0);
          return (
            <button
              key={n.id}
              onClick={() => addToNote(n.id)}
              style={{
                flexShrink: 0,
                position: "relative",
                background:
                  flash === n.name
                    ? PALETTE.amber
                    : `linear-gradient(180deg, #2c2620, ${PALETTE.panelSoft})`,
                border: `1px solid ${
                  flash === n.name
                    ? PALETTE.amber
                    : dueMode
                    ? PALETTE.danger
                    : "#3a322b"
                }`,
                color: flash === n.name ? "#1a1510" : PALETTE.cream,
                borderRadius: 20,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.25s",
              }}
              title={dueMode ? t.dueTooltip : t.tapTooltip}
            >
              {n.name}
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 400,
                  opacity: 0.75,
                  marginTop: 1,
                }}
              >
                {t.thisMonth} ৳{fmt(monthlyTotal(n))}
              </div>
              {dueTotal > 0 && (
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    color: PALETTE.danger,
                    marginTop: 1,
                  }}
                >
                  {t.due} ৳{fmt(dueTotal)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Keypad */}
      <div style={{ display: "grid", gap: 10 }}>
        {KEYS.map((row, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns:
                row.length === 3 ? "1fr 1fr 1fr" : "repeat(4, 1fr)",
              gap: 10,
            }}
          >
            {row.map((k) => {
              const isEq = k === "=";
              const isOp = ["÷", "×", "−", "+"].includes(k);
              const isFn = ["C", "⌫", "%"].includes(k);
              return (
                <button
                  key={k}
                  onClick={() => pressKey(k)}
                  style={{
                    gridColumn: isEq ? "span 1" : undefined,
                    height: 58,
                    borderRadius: 16,
                    border: "none",
                    fontSize: 20,
                    fontWeight: 500,
                    cursor: "pointer",
                    background: isEq
                      ? `linear-gradient(180deg, ${PALETTE.amber}, ${PALETTE.amberSoft})`
                      : isOp
                      ? PALETTE.panelSoft
                      : isFn
                      ? "#2a231d"
                      : "#211c18",
                    color: isEq
                      ? "#1a1510"
                      : isOp
                      ? PALETTE.amber
                      : isFn
                      ? PALETTE.danger
                      : PALETTE.cream,
                    boxShadow: isEq
                      ? "0 6px 16px -4px rgba(227,168,87,0.5)"
                      : "inset 0 1px 0 rgba(255,255,255,0.03)",
                  }}
                >
                  {k}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {notes.length > 0 && (
        <div
          style={{
            marginTop: 14,
            textAlign: "center",
            color: dueMode ? PALETTE.danger : PALETTE.dim,
            fontSize: 11.5,
          }}
        >
          {dueMode ? t.hintDue : t.hintNormal}
        </div>
      )}
    </div>
  );
}

function NotesListView({
  notes,
  monthlyTotal,
  onBack,
  onOpen,
  onAdd,
  onDelete,
  notifCount,
  openNotifications,
}) {
  const { t } = useLang();
  return (
    <div style={{ padding: "4px 18px 22px", minHeight: 480 }}>
      <TopBar
        title={t.notesTitle}
        onBack={onBack}
        right={
          <button
            onClick={openNotifications}
            style={{
              position: "relative",
              background: "none",
              border: "none",
              color: PALETTE.amber,
              cursor: "pointer",
              display: "flex",
            }}
            aria-label={t.notifAria}
          >
            <Bell size={19} />
            {notifCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -3,
                  right: -3,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: PALETTE.danger,
                }}
              />
            )}
          </button>
        }
      />

      {notes.length === 0 && (
        <div
          style={{
            marginTop: 60,
            textAlign: "center",
            color: PALETTE.dim,
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          {t.noNotes1}
          <br />
          {t.noNotes2}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {notes.map((n) => (
          <div
            key={n.id}
            style={{
              background: PALETTE.panelSoft,
              borderRadius: 16,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              border: "1px solid #322b25",
            }}
          >
            <div onClick={() => onOpen(n.id)} style={{ cursor: "pointer", flex: 1 }}>
              <div style={{ color: PALETTE.cream, fontWeight: 600, fontSize: 15 }}>
                {n.name}
              </div>
              <div style={{ color: PALETTE.amber, fontSize: 13, marginTop: 3 }}>
                {t.thisMonth} ৳{fmt(monthlyTotal(n))}
              </div>
              <div style={{ color: PALETTE.dim, fontSize: 11, marginTop: 2 }}>
                {t.entriesTotal(n.entries.length)}
              </div>
            </div>
            <button
              onClick={() => onDelete(n.id)}
              style={{
                background: "none",
                border: "none",
                color: PALETTE.dim,
                cursor: "pointer",
                padding: 6,
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={onAdd}
        style={{
          marginTop: 18,
          width: "100%",
          padding: "12px",
          borderRadius: 14,
          border: `1px dashed ${PALETTE.amberSoft}`,
          background: "none",
          color: PALETTE.amber,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          cursor: "pointer",
          fontSize: 13.5,
        }}
      >
        <Plus size={15} /> {t.createNote}
      </button>
    </div>
  );
}

function NoteDetailView({ note, groups, monthlyTotal, dues, onQueueSettle, onBack, onDeleteEntry }) {
  const { t } = useLang();
  return (
    <div style={{ padding: "4px 18px 22px", minHeight: 480 }}>
      <TopBar title={note.name} onBack={onBack} />
      <div
        style={{
          marginTop: 8,
          background: `linear-gradient(135deg, ${PALETTE.amber}, ${PALETTE.amberSoft})`,
          borderRadius: 16,
          padding: "16px 18px",
          color: "#1a1510",
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.75 }}>{t.monthTotalLabel}</div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>৳{fmt(monthlyTotal)}</div>
      </div>

      {dues && dues.length > 0 && (
        <div
          style={{
            marginTop: 14,
            background: `${PALETTE.danger}18`,
            border: `1px solid ${PALETTE.danger}55`,
            borderRadius: 16,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              color: PALETTE.danger,
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            {t.duesListTitle(fmt(dues.reduce((s, e) => s + e.amount, 0)))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dues.map((e) => (
              <div
                key={e.ts}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: PALETTE.panelSoft,
                  borderRadius: 12,
                  padding: "9px 12px",
                }}
              >
                <div>
                  <div style={{ color: PALETTE.cream, fontSize: 14 }}>৳{fmt(e.amount)}</div>
                  <div style={{ color: PALETTE.dim, fontSize: 10.5 }}>
                    {t.takenAt}{" "}
                    {new Date(e.ts).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <button
                  onClick={() => onQueueSettle(e)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: `linear-gradient(180deg, ${PALETTE.amber}, ${PALETTE.amberSoft})`,
                    color: "#1a1510",
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.settle}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
        {groups.length === 0 && (
          <div style={{ color: PALETTE.dim, fontSize: 13, textAlign: "center", marginTop: 30 }}>
            {t.noEntries}
          </div>
        )}
        {groups.map((g, gi) => (
          <div key={gi}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: PALETTE.dim,
                fontSize: 12,
                marginBottom: 6,
                paddingLeft: 2,
              }}
            >
              <span>{g.label}</span>
              <span style={{ color: PALETTE.amber }}>৳{fmt(g.total)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {g.entries
                .slice()
                .reverse()
                .map((e) => {
                  const wasDue = !!e.settledAt;
                  return (
                    <div
                      key={e.ts}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: PALETTE.panelSoft,
                        borderRadius: 12,
                        padding: "10px 12px",
                      }}
                    >
                      <div>
                        <div style={{ color: PALETTE.cream, fontSize: 14 }}>
                          ৳{fmt(e.amount)}
                          {wasDue && (
                            <span
                              style={{
                                fontSize: 9.5,
                                color: PALETTE.danger,
                                marginLeft: 6,
                                fontWeight: 600,
                              }}
                            >
                              {t.wasDue}
                            </span>
                          )}
                        </div>
                        {wasDue ? (
                          <div style={{ color: PALETTE.dim, fontSize: 10.5 }}>
                            {t.takenLabel}{" "}
                            {new Date(e.ts).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                            })}
                            {" · "}
                            {t.settledLabel}{" "}
                            {new Date(e.settledAt).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                            })}
                          </div>
                        ) : (
                          <div style={{ color: PALETTE.dim, fontSize: 10.5 }}>
                            {new Date(e.ts).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => onDeleteEntry(e.ts)}
                        style={{
                          background: "none",
                          border: "none",
                          color: PALETTE.dim,
                          cursor: "pointer",
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsView({ items, onBack, onDismiss }) {
  const { t } = useLang();
  return (
    <div style={{ padding: "4px 18px 22px", minHeight: 480 }}>
      <TopBar title={t.notifTitle} onBack={onBack} />
      {items.length === 0 && (
        <div
          style={{
            marginTop: 60,
            textAlign: "center",
            color: PALETTE.dim,
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          {t.noNotif1}
          <br />
          {t.noNotif2}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {items.map((it) => (
          <div
            key={it.noteId + it.monthKey}
            style={{
              background: PALETTE.panelSoft,
              borderRadius: 16,
              padding: "14px 16px",
              border: `1px solid ${PALETTE.amberSoft}55`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Bell size={14} color={PALETTE.amber} />
              <div style={{ color: PALETTE.cream, fontSize: 13.5, fontWeight: 600 }}>
                {t.monthEnded(it.label)}
              </div>
            </div>
            <div style={{ color: PALETTE.dim, fontSize: 12.5, marginTop: 4 }}>
              {t.notifSpentLine(it.noteName)}
            </div>
            <div style={{ color: PALETTE.amber, fontSize: 20, fontWeight: 700, marginTop: 4 }}>
              ৳{fmt(it.total)}
            </div>
            <div style={{ color: PALETTE.dim, fontSize: 11, marginTop: 4 }}>
              {t.notifFootnote}
            </div>
            <button
              onClick={() => onDismiss(it.noteId, it.monthKey)}
              style={{
                marginTop: 10,
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(180deg, ${PALETTE.amber}, ${PALETTE.amberSoft})`,
                color: "#1a1510",
                fontWeight: 600,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {t.ok}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettleAmountModal({ dueAmount, value, onChange, onCancel, onConfirm }) {
  const { t } = useLang();
  const numVal = parseFloat(value);
  const isValid = !isNaN(numVal) && numVal > 0;
  const isPartial = isValid && numVal < dueAmount;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(10,8,6,0.7)",
        display: "flex",
        alignItems: "flex-end",
        borderRadius: 34,
      }}
    >
      <div
        style={{
          width: "100%",
          background: PALETTE.panel,
          borderTop: `1px solid #3a322b`,
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px 26px",
        }}
      >
        <div style={{ color: PALETTE.cream, fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
          {t.settleModalTitle}
        </div>
        <div style={{ color: PALETTE.dim, fontSize: 12, marginBottom: 12 }}>
          {t.settleModalSubtitle(fmt(dueAmount))}
        </div>
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onConfirm()}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: PALETTE.panelSoft,
            border: `1px solid ${isValid ? "#3a322b" : PALETTE.danger}`,
            borderRadius: 12,
            padding: "12px 14px",
            color: PALETTE.cream,
            fontSize: 18,
            outline: "none",
          }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={() => onChange(String(dueAmount))}
            style={{
              padding: "7px 12px",
              borderRadius: 10,
              border: `1px solid ${PALETTE.amberSoft}`,
              background: "none",
              color: PALETTE.amber,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t.payFull(fmt(dueAmount))}
          </button>
          <button
            onClick={() => onChange(String(Math.round((dueAmount / 2) * 100) / 100))}
            style={{
              padding: "7px 12px",
              borderRadius: 10,
              border: `1px solid #3a322b`,
              background: "none",
              color: PALETTE.dim,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t.payHalf(fmt(dueAmount / 2))}
          </button>
        </div>

        {isPartial && (
          <div style={{ color: PALETTE.dim, fontSize: 11, marginTop: 8 }}>
            {t.remainingDueNote(fmt(dueAmount - numVal))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #3a322b",
              background: "none",
              color: PALETTE.dim,
              cursor: "pointer",
            }}
          >
            {t.cancel}
          </button>
          <button
            onClick={onConfirm}
            disabled={!isValid}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 12,
              border: "none",
              background: isValid
                ? `linear-gradient(180deg, ${PALETTE.amber}, ${PALETTE.amberSoft})`
                : "#3a322b",
              color: isValid ? "#1a1510" : PALETTE.dim,
              fontWeight: 600,
              cursor: isValid ? "pointer" : "not-allowed",
            }}
          >
            {t.addToCalculator}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddNoteModal({ value, onChange, onCancel, onCreate }) {
  const { t } = useLang();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(10,8,6,0.7)",
        display: "flex",
        alignItems: "flex-end",
        borderRadius: 34,
      }}
    >
      <div
        style={{
          width: "100%",
          background: PALETTE.panel,
          borderTop: `1px solid #3a322b`,
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px 26px",
        }}
      >
        <div style={{ color: PALETTE.cream, fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
          {t.addNoteTitle}
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onCreate()}
          placeholder={t.addNotePlaceholder}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: PALETTE.panelSoft,
            border: "1px solid #3a322b",
            borderRadius: 12,
            padding: "12px 14px",
            color: PALETTE.cream,
            fontSize: 14,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #3a322b",
              background: "none",
              color: PALETTE.dim,
              cursor: "pointer",
            }}
          >
            {t.cancel}
          </button>
          <button
            onClick={onCreate}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 12,
              border: "none",
              background: `linear-gradient(180deg, ${PALETTE.amber}, ${PALETTE.amberSoft})`,
              color: "#1a1510",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t.create}
          </button>
        </div>
      </div>
    </div>
  );
}
