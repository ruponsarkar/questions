import { useEffect, useMemo, useRef, useState } from "react";

export default function App() {
  const [subjects, setSubjects] = useState([]);
  const [syllabuses, setSyllabuses] = useState([]);

  const [form, setForm] = useState({
    subjectId: "",
    syllabusId: "",
    questionCount: 10,
    perPage: 5,
    timerSeconds: 15,
  });

  const [quizState, setQuizState] = useState({
    loading: false,
    error: "",
    availableCount: 0,
    questions: [],
  });

  const [session, setSession] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  /*
   * ============================================================
   * LOAD SUBJECTS
   * ============================================================
   */
  useEffect(() => {
    fetch("/api/subjects")
      .then((res) => res.json())
      .then((data) => {
        setSubjects(data.subjects || []);
      })
      .catch(() => {
        setQuizState((current) => ({
          ...current,
          error: "Unable to load subjects.",
        }));
      });
  }, []);

  /*
   * ============================================================
   * LOAD SYLLABUSES
   * ============================================================
   */
  useEffect(() => {
    if (!form.subjectId) {
      setSyllabuses([]);

      setForm((current) => ({
        ...current,
        syllabusId: "",
      }));

      return;
    }

    fetch(`/api/syllabuses?subject_id=${form.subjectId}`)
      .then((res) => res.json())
      .then((data) => {
        setSyllabuses(data.syllabuses || []);

        setForm((current) => ({
          ...current,
          syllabusId: "",
        }));
      })
      .catch(() => {
        setQuizState((current) => ({
          ...current,
          error: "Unable to load syllabuses.",
        }));
      });
  }, [form.subjectId]);

  /*
   * ============================================================
   * CURRENT QUESTION
   * ============================================================
   */
  const currentQuestion = useMemo(() => {
    if (!session) {
      return null;
    }

    return session.questions[session.activeQuestionIndex] || null;
  }, [session]);

  /*
   * ============================================================
   * TIMER CLOCK
   * ============================================================
   */
  function TimerClock({ remaining, total, isActive }) {
    const radius = 48;
    const stroke = 15;

    const normalizedRadius = radius - stroke * 0.5;

    const circumference = 2 * Math.PI * normalizedRadius;

    const progress = total ? Math.max(0, Math.min(1, remaining / total)) : 0;

    const offset = circumference - progress * circumference;

    const [pulseKey, setPulseKey] = useState(0);

    const prev = useRef(remaining);

    useEffect(() => {
      if (prev.current !== remaining) {
        setPulseKey((key) => key + 1);
        prev.current = remaining;
      }
    }, [remaining]);

    return (
      <div
        className={`timer-clock ${isActive ? "active" : "idle"}`}
        key={pulseKey}
      >
        <svg
          height={radius * 2}
          width={radius * 2}
          className="timer-svg"
          viewBox={`0 0 ${radius * 2} ${radius * 2}`}
        >
          <g transform={`rotate(-90 ${radius} ${radius})`}>
            <circle
              stroke="#eee"
              fill="transparent"
              strokeWidth={stroke}
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />

            <circle
              className="progress"
              stroke="#4f46e5"
              fill="transparent"
              strokeWidth={stroke}
              strokeLinecap="round"
              r={normalizedRadius}
              cx={radius}
              cy={radius}
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={offset}
            />
          </g>
        </svg>

        <div className={`timer-number ${isActive ? "pulse" : ""}`}>
          {remaining}s
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * TIMER
   *
   * Timer runs only for the active question.
   *
   * When answer is revealed:
   * - timer stops
   * - 2 second delay starts
   * ============================================================
   */
  useEffect(() => {
    if (!session || !currentQuestion) {
      return;
    }

    /*
     * Don't run timer after quiz completion.
     */
    if (session.completed) {
      return;
    }

    /*
     * Don't run timer while answer is being shown.
     */
    if (session.revealedQuestionIds.includes(currentQuestion.id)) {
      return;
    }

    /*
     * Don't run timer while waiting to
     * advance to next question.
     */
    if (session.pendingAdvance) {
      return;
    }

    /*
     * Start timer for the current question.
     */
    setRemainingSeconds(session.timerSeconds);

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(intervalId);

          revealCurrentQuestion();

          return 0;
        }

        return seconds - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    currentQuestion?.id,
    session?.timerSeconds,
    session?.completed,
    session?.pendingAdvance,
    session?.revealedQuestionIds,
  ]);

  /*
   * ============================================================
   * ADVANCE TO NEXT QUESTION
   *
   * Answer shown
   *      ↓
   * Wait 2 seconds
   *      ↓
   * Hide current question
   *      ↓
   * Next question becomes active
   * ============================================================
   */
  useEffect(() => {
    if (!session || !session.pendingAdvance) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSession((current) => {
        if (!current) {
          return current;
        }

        const nextIndex = current.activeQuestionIndex + 1;

        /*
         * Last question.
         */
        if (nextIndex >= current.questions.length) {
          return {
            ...current,
            pendingAdvance: false,
            completed: true,
          };
        }

        /*
         * Move to next question.
         *
         * The previous question will disappear
         * because visibleQuestions starts from
         * activeQuestionIndex.
         */
        return {
          ...current,
          activeQuestionIndex: nextIndex,
          pendingAdvance: false,
        };
      });

      setRemainingSeconds(0);
    }, 2000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [session?.pendingAdvance]);

  /*
   * ============================================================
   * FORM UPDATE
   * ============================================================
   */
  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  /*
   * ============================================================
   * START QUIZ
   * ============================================================
   */
  function startQuiz(event) {
    event.preventDefault();

    setQuizState({
      loading: true,
      error: "",
      availableCount: 0,
      questions: [],
    });

    fetch("/api/quiz", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subjectId: Number(form.subjectId),
        syllabusId: Number(form.syllabusId),
        questionCount: Number(form.questionCount),
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          throw new Error(data.error);
        }

        if (!data.questions?.length) {
          throw new Error("No questions found for this selection.");
        }

        setQuizState({
          loading: false,
          error: "",
          availableCount: data.availableCount,
          questions: data.questions,
        });

        setSession({
          questions: data.questions,

          perPage: Number(form.perPage),

          timerSeconds: Number(form.timerSeconds),

          activeQuestionIndex: 0,

          selectedAnswers: {},

          /*
           * Questions whose answers
           * have been revealed.
           */
          revealedQuestionIds: [],

          /*
           * True during the 2 second
           * answer display period.
           */
          pendingAdvance: false,

          completed: false,

          /*
           * When true, all questions
           * are displayed again.
           */
          showAllQuestions: false,
        });

        setRemainingSeconds(Number(form.timerSeconds));
      })
      .catch((error) => {
        setSession(null);

        setRemainingSeconds(0);

        setQuizState({
          loading: false,
          error: error.message || "Unable to start quiz.",
          availableCount: 0,
          questions: [],
        });
      });
  }

  /*
   * ============================================================
   * CHOOSE ANSWER
   * ============================================================
   */
  function chooseAnswer(questionId, answerId) {
    if (!session) {
      return;
    }

    /*
     * Don't allow answer selection
     * after answer is revealed.
     */
    if (session.revealedQuestionIds.includes(questionId)) {
      return;
    }

    /*
     * Only active question can be answered.
     */
    const activeQuestion = session.questions[session.activeQuestionIndex];

    if (!activeQuestion || activeQuestion.id !== questionId) {
      return;
    }

    /*
     * Don't allow answer changes
     * during answer display.
     */
    if (session.pendingAdvance) {
      return;
    }

    /*
     * Don't allow changes after
     * quiz completion.
     */
    if (session.completed) {
      return;
    }

    setSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,

        selectedAnswers: {
          ...current.selectedAnswers,

          [questionId]: answerId,
        },
      };
    });
  }

  /*
   * ============================================================
   * REVEAL CURRENT QUESTION
   * ============================================================
   */
  function revealCurrentQuestion() {
    setSession((current) => {
      if (!current) {
        return current;
      }

      const question = current.questions[current.activeQuestionIndex];

      if (!question) {
        return current;
      }

      /*
       * Already revealed.
       */
      if (current.revealedQuestionIds.includes(question.id)) {
        return current;
      }

      return {
        ...current,

        revealedQuestionIds: [...current.revealedQuestionIds, question.id],

        /*
         * Start 2 second delay.
         */
        pendingAdvance: true,
      };
    });
  }

  /*
   * ============================================================
   * SHOW ALL QUESTIONS
   * ============================================================
   */
  function showAllQuestions() {
    setSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        showAllQuestions: true,
        completed: true,
        pendingAdvance: false,
      };
    });

    setRemainingSeconds(0);
  }

  /*
   * ============================================================
   * RESET QUIZ
   * ============================================================
   */
  function resetQuiz() {
    setSession(null);
    setRemainingSeconds(0);
  }

  /*
   * ============================================================
   * VISIBLE QUESTIONS
   *
   * IMPORTANT:
   *
   * Normal quiz:
   *
   *   [Current question]
   *   [Question below]
   *   [Question below]
   *   [Question below]
   *
   * After current question is completed:
   *
   *   current question disappears
   *
   *   [Next question]
   *   [Question below]
   *   [Question below]
   *
   * ============================================================
   */
  const visibleQuestions = useMemo(() => {
    if (!session) {
      return [];
    }

    /*
     * Show everything after clicking
     * "Show All Questions".
     */
    if (session.showAllQuestions) {
      return session.questions;
    }

    /*
     * Quiz completed:
     * hide question list until
     * Show All Questions is clicked.
     */
    if (session.completed) {
      return [];
    }

    /*
     * IMPORTANT:
     *
     * Start from activeQuestionIndex.
     *
     * This means questions BELOW the
     * active question remain visible.
     *
     * Once activeQuestionIndex increases,
     * the previous question disappears.
     */
    return session.questions.slice(session.activeQuestionIndex);
  }, [session]);

  /*
   * ============================================================
   * SCORE
   * ============================================================
   */
  const score = useMemo(() => {
    if (!session) {
      return 0;
    }

    return session.questions.reduce((total, question) => {
      const selected = session.selectedAnswers[question.id];

      const correct = question.options.find((option) => option.isRight);

      if (selected && correct && selected === correct.id) {
        return total + 1;
      }

      return total;
    }, 0);
  }, [session]);

  /*
   * ============================================================
   * CURRENT QUESTION NUMBER
   * ============================================================
   */
  const currentQuestionNumber = session
    ? Math.min(session.activeQuestionIndex + 1, session.questions.length)
    : 0;

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */
  return (
    <main className="shell">
      <style>{`
        .timer-wrapper {
          display: inline-flex;
          align-items: center;
        }

        .timer-clock {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .timer-svg {
          width: 36px;
          height: 36px;
          display: block;
        }

        .timer-clock .progress {
          transition:
            stroke-dashoffset
            0.5s linear;
        }

        .timer-number {
          font-weight: 700;
          font-size: 2.95rem;
          min-width: 40px;
          text-align: center;
          display: inline-block;
        }

        .pulse {
          animation:
            pulse
            0.6s ease-out;
        }

        @keyframes pulse {
          0% {
            transform: scale(1);
          }

          50% {
            transform: scale(1.18);
          }

          100% {
            transform: scale(1);
          }
        }

        .answer-shown {
          font-weight: 700;
          color: #16a34a;
        }

        .show-all-wrapper {
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: 24px;
        }

        .question-list {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .question-card {
          transition:
            opacity 0.25s ease,
            transform 0.25s ease;
        }

        .question-card.active {
          border-color: #4f46e5;
        }

        .question-card.revealed {
          border-color: #16a34a;
        }
      `}</style>

      {/* ========================================================
          HERO
          ======================================================== */}
      <section className="hero">
        <div>
          <p className="eyebrow">React Quiz Interface</p>

          <h1>
            Pick a subject, tune the timer, and run a focused practice session.
          </h1>

          <p className="hero-copy">
            Lightweight by design: fast setup, clean cards, and sequential timer
            control for each question.
          </p>
        </div>

        <div className="hero-stats">
          <div className="stat">
            <span>Subjects</span>

            <strong>{subjects.length}</strong>
          </div>

          <div className="stat">
            <span>Loaded Quiz Questions</span>

            <strong>{quizState.questions.length}</strong>
          </div>
        </div>
      </section>

      {/* ========================================================
          MAIN
          ======================================================== */}
      <section className="panel layout">
        {/* ======================================================
            QUIZ SETUP
            ====================================================== */}
        <form className="config-card" onSubmit={startQuiz}>
          <h2>Quiz Setup</h2>

          {/* Subject */}
          <label>
            <span>Subject</span>

            <select
              name="subjectId"
              value={form.subjectId}
              onChange={updateField}
              required
            >
              <option value="">Select a subject</option>

              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.subName} ({subject.questionCount})
                </option>
              ))}
            </select>
          </label>

          {/* Syllabus */}
          <label>
            <span>Syllabus</span>

            <select
              name="syllabusId"
              value={form.syllabusId}
              onChange={updateField}
              required
              disabled={!syllabuses.length}
            >
              <option value="">Select a syllabus</option>

              {syllabuses.map((syllabus) => (
                <option key={syllabus.id} value={syllabus.id}>
                  {syllabus.syllabus} ({syllabus.questionCount})
                </option>
              ))}
            </select>
          </label>

          {/* Fields */}
          <div className="field-grid">
            {/* Question count */}
            <label>
              <span>How many questions</span>

              <input
                type="number"
                name="questionCount"
                min="1"
                max="100"
                value={form.questionCount}
                onChange={updateField}
                required
              />
            </label>

            {/* Questions per page */}
            <label>
              <span>Questions per page</span>

              <input
                type="number"
                name="perPage"
                min="1"
                max="20"
                value={form.perPage}
                onChange={updateField}
                required
              />
            </label>

            {/* Timer */}
            <label>
              <span>Timer per question</span>

              <input
                type="number"
                name="timerSeconds"
                min="5"
                max="300"
                value={form.timerSeconds}
                onChange={updateField}
                required
              />
            </label>
          </div>

          {/* Start button */}
          <button
            className="primary-button"
            type="submit"
            disabled={quizState.loading}
          >
            {quizState.loading ? "Loading quiz..." : "Start quiz"}
          </button>

          {/* Error */}
          {quizState.error ? (
            <p className="error-text">{quizState.error}</p>
          ) : null}

          {/* Available questions */}
          {quizState.availableCount ? (
            <p className="muted-text">
              Available questions in this syllabus: {quizState.availableCount}
            </p>
          ) : null}
        </form>

        {/* ======================================================
            QUIZ
            ====================================================== */}
        <section className="quiz-card">
          {!session ? (
            /*
             * ==================================================
             * EMPTY STATE
             * ==================================================
             */
            <div className="empty-state">
              <h2>Ready for practice</h2>

              <p>
                Choose a subject and syllabus, then the quiz will appear here
                with timed question cards and random options.
              </p>
            </div>
          ) : (
            <>
              {/* ================================================
                  TOOLBAR
                  ================================================ */}
              <div className="quiz-toolbar">
                {/* Progress */}
                <div>
                  <p className="toolbar-label">Progress</p>

                  <strong>
                    Question {currentQuestionNumber} of{" "}
                    {session.questions.length}
                  </strong>
                </div>

                {/* Current question */}
                <div>
                  <p className="toolbar-label">Current</p>

                  <strong>
                    {currentQuestionNumber} / {session.questions.length}
                  </strong>
                </div>

                {/* Timer */}
                <div>
                  <p className="toolbar-label">Timer</p>

                  <strong>
                    {session.completed
                      ? "Done"
                      : session.pendingAdvance
                        ? "Answer shown"
                        : `${remainingSeconds}s`}
                  </strong>
                </div>

                {/* Reset */}
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetQuiz}
                >
                  Reset
                </button>
              </div>

              {/* ================================================
                  QUESTION LIST
                  ================================================ */}
              <div className="question-list">
                {visibleQuestions.map((question, index) => {
                  /*
                   * Because visibleQuestions
                   * starts at activeQuestionIndex,
                   * the actual question number
                   * is:
                   *
                   * active index + index
                   */
                  const absoluteIndex = session.showAllQuestions
                    ? index
                    : session.activeQuestionIndex + index;

                  const isActive =
                    !session.showAllQuestions &&
                    absoluteIndex === session.activeQuestionIndex &&
                    !session.completed;

                  const isRevealed = session.revealedQuestionIds.includes(
                    question.id,
                  );

                  const selectedAnswerId = session.selectedAnswers[question.id];

                  return (
                    <article
                      key={question.id}
                      className={`question-card ${isActive ? "active" : ""} ${
                        isRevealed ? "revealed" : ""
                      }`}
                    >
                      {/* Question header */}
                      <div className="question-header">
                        <span>Q{absoluteIndex + 1}</span>

                        <span>
                          {isActive && !isRevealed ? (
                            /*
                             * Active question:
                             * show timer.
                             */
                            <div className="timer-wrapper">
                              <TimerClock
                                remaining={remainingSeconds}
                                total={session.timerSeconds}
                                isActive={isActive && !session.pendingAdvance}
                              />
                            </div>
                          ) : isRevealed ? (
                            /*
                             * Answer has been shown.
                             */
                            <span className="answer-shown">Answer shown</span>
                          ) : (
                            /*
                             * Questions below
                             * current question.
                             */
                            "Waiting"
                          )}
                        </span>
                      </div>

                      {/* Question body */}
                      <div
                        className="question-body"
                        dangerouslySetInnerHTML={{
                          __html: question.questionHtml,
                        }}
                      />

                      {/* Options */}
                      <div className="option-list">
                        {question.options.map((option) => {
                          const isSelected = selectedAnswerId === option.id;

                          const showCorrect = isRevealed && option.isRight;

                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`option-button ${
                                isSelected ? "selected" : ""
                              } ${showCorrect ? "correct" : ""}`}
                              onClick={() =>
                                chooseAnswer(question.id, option.id)
                              }
                              disabled={
                                !isActive ||
                                isRevealed ||
                                session.showAllQuestions
                              }
                            >
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: option.answerHtml,
                                }}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* ================================================
                  COMPLETED
                  ================================================ */}
              {session.completed && !session.showAllQuestions ? (
                <>
                  <div className="result-card">
                    <h3>Session complete</h3>

                    <p>
                      Score: {score} / {session.questions.length}
                    </p>
                  </div>

                  {/* Show all button */}
                  <div className="show-all-wrapper">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={showAllQuestions}
                    >
                      Show All Questions
                    </button>
                  </div>
                </>
              ) : null}

              {/* ================================================
                  ALL QUESTIONS
                  ================================================ */}
              {session.completed && session.showAllQuestions ? (
                <div className="result-card">
                  <h3>Quiz Review</h3>

                  <p>
                    Score: {score} / {session.questions.length}
                  </p>

                  <p>All questions and correct answers are shown above.</p>
                </div>
              ) : null}
            </>
          )}
        </section>
      </section>
    </main>
  );
}
