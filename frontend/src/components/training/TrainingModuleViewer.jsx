import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, AlertTriangle, Award } from "lucide-react";
import { toast } from "sonner";
import QuizComponent from "./QuizComponent";

export default function TrainingModuleViewer({ module, onClose, onComplete }) {
  const [activeTab, setActiveTab] = useState('content');
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [quizScore, setQuizScore] = useState(null);

  const handleQuizComplete = (score, total) => {
    const percentage = (score / total) * 100;
    setQuizScore({ score, total, percentage });
    setQuizCompleted(true);
    
    if (score / total >= 0.8) {
      toast.success(`Excellent! You scored ${score}/${total}`);
      onComplete(module.id, score, total, percentage);
    } else {
      toast.warning(`You scored ${score}/${total}. Review the content and try again.`);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl">{module.module.title}</DialogTitle>
            {module.completed && (
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Completed
              </Badge>
            )}
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="content">Training Content</TabsTrigger>
            <TabsTrigger value="quiz">Assessment Quiz</TabsTrigger>
          </TabsList>

          {/* Content Tab */}
          <TabsContent value="content" className="space-y-6 mt-6">
            {/* Introduction */}
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Introduction</h3>
                <p className="text-gray-700 leading-relaxed">{module.module.introduction}</p>
              </CardContent>
            </Card>

            {/* Learning Objectives */}
            <Card className="border-purple-200">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Learning Objectives</h3>
                <ul className="space-y-2">
                  {module.module.learning_objectives.map((objective, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-700">{objective}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Content Sections */}
            {module.module.sections.map((section, idx) => (
              <Card key={idx} className="border-gray-200">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">{section.section_title}</h3>
                  <div className="text-gray-700 leading-relaxed whitespace-pre-wrap">{section.content}</div>
                </CardContent>
              </Card>
            ))}

            {/* Best Practices */}
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                  Best Practices
                </h3>
                <ul className="space-y-2">
                  {module.module.best_practices.map((practice, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-2 flex-shrink-0" />
                      <span className="text-gray-700">{practice}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Common Pitfalls */}
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  Common Pitfalls to Avoid
                </h3>
                <ul className="space-y-2">
                  {module.module.common_pitfalls.map((pitfall, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <XCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-700">{pitfall}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Action Items */}
            <Card className="border-indigo-200 bg-indigo-50">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Action Items</h3>
                <p className="text-sm text-gray-600 mb-3">Apply what you've learned with these immediate action steps:</p>
                <ul className="space-y-2">
                  {module.module.action_items.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <div className="bg-indigo-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm flex-shrink-0">
                        {idx + 1}
                      </div>
                      <span className="text-gray-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button 
                onClick={() => setActiveTab('quiz')}
                className="bg-gradient-to-r from-purple-600 to-indigo-600"
              >
                Take Assessment Quiz
              </Button>
            </div>
          </TabsContent>

          {/* Quiz Tab */}
          <TabsContent value="quiz" className="mt-6">
            {quizCompleted && quizScore ? (
              <Card className={`border-2 ${quizScore.percentage >= 80 ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                <CardContent className="p-8 text-center">
                  <div className={`w-20 h-20 rounded-full ${quizScore.percentage >= 80 ? 'bg-green-100' : 'bg-amber-100'} flex items-center justify-center mx-auto mb-4`}>
                    {quizScore.percentage >= 80 ? (
                      <Award className="h-10 w-10 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-10 w-10 text-amber-600" />
                    )}
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    {quizScore.percentage >= 80 ? 'Congratulations!' : 'Keep Learning!'}
                  </h3>
                  <p className="text-lg text-gray-700 mb-4">
                    You scored {quizScore.score} out of {quizScore.total} ({quizScore.percentage.toFixed(0)}%)
                  </p>
                  {quizScore.percentage >= 80 ? (
                    <p className="text-green-700 mb-6">
                      Excellent work! You've demonstrated a solid understanding of the material.
                    </p>
                  ) : (
                    <p className="text-amber-700 mb-6">
                      Review the training content and try again to achieve at least 80%.
                    </p>
                  )}
                  <div className="flex justify-center gap-3">
                    <Button variant="outline" onClick={() => setActiveTab('content')}>
                      Review Content
                    </Button>
                    <Button onClick={() => {
                      setQuizCompleted(false);
                      setQuizScore(null);
                    }}>
                      Retake Quiz
                    </Button>
                    {quizScore.percentage >= 80 && (
                      <Button onClick={onClose} className="bg-green-600 hover:bg-green-700">
                        Complete Module
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <QuizComponent 
                quiz={module.quiz} 
                onComplete={handleQuizComplete}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}