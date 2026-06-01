import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";

export default function QuizComponent({ quiz, onComplete }) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [answers, setAnswers] = useState({});

  const handleAnswerSelect = (questionIndex, answerIndex) => {
    setSelectedAnswers({
      ...selectedAnswers,
      [questionIndex]: answerIndex
    });
  };

  const handleNext = () => {
    if (currentQuestion < quiz.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleSubmit = () => {
    const results = {};
    let correctCount = 0;

    quiz.questions.forEach((question, idx) => {
      const isCorrect = selectedAnswers[idx] === question.correct_answer_index;
      results[idx] = isCorrect;
      if (isCorrect) correctCount++;
    });

    setAnswers(results);
    setShowResults(true);
    onComplete(correctCount, quiz.questions.length);
  };

  const question = quiz.questions[currentQuestion];
  const isAnswered = selectedAnswers[currentQuestion] !== undefined;
  const allAnswered = quiz.questions.every((_, idx) => selectedAnswers[idx] !== undefined);

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Question {currentQuestion + 1} of {quiz.questions.length}
          </h3>
          <p className="text-sm text-gray-600">
            {Object.keys(selectedAnswers).length} / {quiz.questions.length} answered
          </p>
        </div>
        <div className="flex gap-2">
          {quiz.questions.map((_, idx) => (
            <div
              key={idx}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                idx === currentQuestion
                  ? 'bg-blue-600 text-white'
                  : selectedAnswers[idx] !== undefined
                  ? showResults
                    ? answers[idx]
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                    : 'bg-gray-200 text-gray-700'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {idx + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Question */}
      <Card className="border-2 border-gray-200">
        <CardContent className="p-6">
          <p className="text-lg font-medium text-gray-900 mb-6">{question.question}</p>

          <div className="space-y-3">
            {question.options.map((option, idx) => {
              const isSelected = selectedAnswers[currentQuestion] === idx;
              const isCorrect = idx === question.correct_answer_index;
              const showCorrectness = showResults && isSelected;

              return (
                <button
                  key={idx}
                  onClick={() => !showResults && handleAnswerSelect(currentQuestion, idx)}
                  disabled={showResults}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    showResults
                      ? isCorrect
                        ? 'border-green-500 bg-green-50'
                        : isSelected
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-200 bg-white'
                      : isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                  } ${showResults ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">{option}</span>
                    {showResults && isCorrect && (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    )}
                    {showResults && isSelected && !isCorrect && (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {showResults && (
            <div className={`mt-6 p-4 rounded-lg ${
              answers[currentQuestion] ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'
            }`}>
              <div className="flex items-start gap-2">
                {answers[currentQuestion] ? (
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                )}
                <div>
                  <p className={`font-semibold ${answers[currentQuestion] ? 'text-green-800' : 'text-amber-800'}`}>
                    {answers[currentQuestion] ? 'Correct!' : 'Incorrect'}
                  </p>
                  <p className="text-sm text-gray-700 mt-1">{question.explanation}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          onClick={handlePrevious}
          disabled={currentQuestion === 0}
          variant="outline"
        >
          Previous
        </Button>

        <div className="flex gap-3">
          {currentQuestion < quiz.questions.length - 1 ? (
            <Button
              onClick={handleNext}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Next Question
            </Button>
          ) : !showResults ? (
            <Button
              onClick={handleSubmit}
              disabled={!allAnswered}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            >
              Submit Quiz
            </Button>
          ) : null}
        </div>
      </div>

      {!allAnswered && !showResults && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> Please answer all questions before submitting the quiz.
          </p>
        </div>
      )}
    </div>
  );
}