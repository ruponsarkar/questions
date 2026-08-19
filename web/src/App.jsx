import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    fetch("/api/subjects")
      .then((res) => res.json())
      .then((data) => setSubjects(data.subjects || []))
      .catch(() => {
        setQuizState((current) => ({
          ...current,
          error: "Unable to load subjects.",
        }));
      });
  }, []);

  useEffect(() => {
    if (!form.subjectId) {
      setSyllabuses([]);
      setForm((current) => ({ ...current, syllabusId: "" }));
      return;
    }

    fetch(`/api/syllabuses?subject_id=${form.subjectId}`)
      .then((res) => res.json())
      .then((data) => {
        setSyllabuses(data.syllabuses || []);
        setForm((current) => ({ ...current, syllabusId: "" }));
      })
      .catch(() => {
        setQuizState((current) => ({
          ...current,
          error: "Unable to load syllabuses.",
        }));
      });
  }, [form.subjectId]);

  const pageCount = useMemo(() => {
    if (!session) {
      return 0;
    }
    return Math.ceil(session.questions.length / session.perPage);
  }, [session]);

  const currentQuestion = session ? session.questions[session.activeQuestionIndex] : null;
  const currentPage = session ? Math.floor(session.activeQuestionIndex / session.perPage) + 1 : 0;

  useEffect(() => {
    if (!session || session.revealedQuestionIds.includes(currentQuestion?.id)) {
      return;
    }

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

    return () => window.clearInterval(intervalId);
  }, [currentQuestion?.id, session]);

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
        if (nextIndex >= current.questions.length) {
          return {
            ...current,
            pendingAdvance: false,
            completed: true,
          };
        }

        return {
          ...current,
          activeQuestionIndex: nextIndex,
          pendingAdvance: false,
        };
      });
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [session]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

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
          revealedQuestionIds: [],
          pendingAdvance: false,
          completed: false,
        });
      })
      .catch((error) => {
        setSession(null);
        setQuizState({
          loading: false,
          error: error.message || "Unable to start quiz.",
          availableCount: 0,
          questions: [],
        });
      });
  }

  function chooseAnswer(questionId, answerId) {
    if (!session || session.revealedQuestionIds.includes(questionId)) {
      return;
    }

    setSession((current) => ({
      ...current,
      selectedAnswers: {
        ...current.selectedAnswers,
        [questionId]: answerId,
      },
    }));
  }

  function revealCurrentQuestion() {
    setSession((current) => {
      if (!current) {
        return current;
      }
      const question = current.questions[current.activeQuestionIndex];
      if (!question || current.revealedQuestionIds.includes(question.id)) {
        return current;
      }

      return {
        ...current,
        revealedQuestionIds: [...current.revealedQuestionIds, question.id],
        pendingAdvance: true,
      };
    });
  }

  function resetQuiz() {
    setSession(null);
    setRemainingSeconds(0);
  }

  const visibleQuestions = useMemo(() => {
    if (!session) {
      return [];
    }

    const start = Math.floor(session.activeQuestionIndex / session.perPage) * session.perPage;
    return session.questions.slice(start, start + session.perPage);
  }, [session]);

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

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">React Quiz Interface</p>
          <h1>Pick a subject, tune the timer, and run a focused practice session.</h1>
          <p className="hero-copy">
            Lightweight by design: fast setup, clean cards, and sequential timer control for each question.
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

      <section className="panel layout">
        <form className="config-card" onSubmit={startQuiz}>
          <h2>Quiz Setup</h2>

          <label>
            <span>Subject</span>
            <select name="subjectId" value={form.subjectId} onChange={updateField} required>
              <option value="">Select a subject</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.subName} ({subject.questionCount})
                </option>
              ))}
            </select>
          </label>

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

          <div className="field-grid">
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

          <button className="primary-button" type="submit" disabled={quizState.loading}>
            {quizState.loading ? "Loading quiz..." : "Start quiz"}
          </button>

          {quizState.error ? <p className="error-text">{quizState.error}</p> : null}
          {quizState.availableCount ? (
            <p className="muted-text">Available questions in this syllabus: {quizState.availableCount}</p>
          ) : null}
        </form>

        <section className="quiz-card">
          {!session ? (
            <div className="empty-state">
              <h2>Ready for practice</h2>
              <p>
                Choose a subject and syllabus, then the quiz will appear here with timed question cards and random
                options.
              </p>
            </div>
          ) : (
            <>
              <div className="quiz-toolbar">
                <div>
                  <p className="toolbar-label">Progress</p>
                  <strong>
                    Question {session.activeQuestionIndex + 1} of {session.questions.length}
                  </strong>
                </div>
                <div>
                  <p className="toolbar-label">Page</p>
                  <strong>
                    {currentPage} / {pageCount}
                  </strong>
                </div>
                <div>
                  <p className="toolbar-label">Timer</p>
                  <strong>{session.completed ? "Done" : `${remainingSeconds}s`}</strong>
                </div>
                <button className="secondary-button" type="button" onClick={resetQuiz}>
                  Reset
                </button>
              </div>

              <div className="question-list">
                {visibleQuestions.map((question, index) => {
                  const pageStart = Math.floor(session.activeQuestionIndex / session.perPage) * session.perPage;
                  const absoluteIndex = pageStart + index;
                  const isActive = absoluteIndex === session.activeQuestionIndex && !session.completed;
                  const isRevealed = session.revealedQuestionIds.includes(question.id);
                  const selectedAnswerId = session.selectedAnswers[question.id];

                  return (
                    <article
                      key={question.id}
                      className={`question-card ${isActive ? "active" : ""} ${isRevealed ? "revealed" : ""}`}
                    >
                      <div className="question-header">
                        <span>Q{absoluteIndex + 1}</span>
                        <span>{isActive ? "Timer running" : isRevealed ? "Answer shown" : "Waiting"}</span>
                      </div>

                      <div className="question-body" dangerouslySetInnerHTML={{ __html: question.questionHtml }} />

                      <div className="option-list">
                        {question.options.map((option) => {
                          const isSelected = selectedAnswerId === option.id;
                          const showCorrect = isRevealed && option.isRight;

                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`option-button ${isSelected ? "selected" : ""} ${showCorrect ? "correct" : ""}`}
                              onClick={() => chooseAnswer(question.id, option.id)}
                              disabled={!isActive || isRevealed}
                            >
                              <span dangerouslySetInnerHTML={{ __html: option.answerHtml }} />
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>

              {session.completed ? (
                <div className="result-card">
                  <h3>Session complete</h3>
                  <p>
                    Score: {score} / {session.questions.length}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </section>
      </section>
    </main>
  );
}
