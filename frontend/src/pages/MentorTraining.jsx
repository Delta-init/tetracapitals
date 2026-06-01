import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  BookOpen, 
  Brain, 
  TrendingUp, 
  Users, 
  DollarSign,
  Target,
  Award,
  Loader2,
  PlayCircle,
  CheckCircle
} from "lucide-react";
import { toast } from "sonner";
import TrainingModuleCard from "../components/training/TrainingModuleCard";
import TrainingModuleViewer from "../components/training/TrainingModuleViewer";

export default function MentorTraining() {
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedModule, setSelectedModule] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [performanceData, setPerformanceData] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions-training'],
    queryFn: () => base44.entities.FundingTransaction.list(),
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students-training'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const { data: targets = [] } = useQuery({
    queryKey: ['targets-training'],
    queryFn: () => base44.entities.MentorTarget.list(),
    enabled: !!currentUser
  });

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers-training'],
    queryFn: () => base44.entities.CommissionLedger.list(),
    enabled: !!currentUser
  });

  const { data: trainingProgress = [], refetch: refetchProgress } = useQuery({
    queryKey: ['training-progress'],
    queryFn: () => base44.entities.TrainingProgress.list('-generated_at'),
    enabled: !!currentUser
  });

  // Calculate mentor performance data
  useEffect(() => {
    if (!currentUser || !transactions.length) return;

    const mentorStudents = students.filter(s => 
      s.primary_mentor_id === currentUser.id || s.senior_mentor_id === currentUser.id
    );
    
    const mentorTransactions = transactions.filter(t => 
      t.primary_mentor_id === currentUser.id || t.senior_mentor_id === currentUser.id
    );
    
    const mentorTargets = targets.filter(t => t.mentor_id === currentUser.id);
    const mentorLedgers = ledgers.filter(l => l.mentor_id === currentUser.id);

    const totalNetDeposit = mentorTransactions
      .filter(t => t.status === 'APPROVED')
      .reduce((sum, t) => {
        return sum + (t.type === 'DEPOSIT' ? t.amount_usd : -t.amount_usd);
      }, 0);

    const activeStudents = mentorStudents.filter(s => s.status === 'ACTIVE').length;
    const totalCommission = mentorLedgers.reduce((sum, l) => sum + (l.commission_release_usd || 0), 0);
    
    const targetAchievement = mentorTargets.length > 0
      ? mentorTargets.reduce((sum, t) => sum + (t.achievement_percent || 0), 0) / mentorTargets.length
      : 0;

    setPerformanceData({
      total_students: mentorStudents.length,
      active_students: activeStudents,
      total_net_deposit: totalNetDeposit,
      total_commission: totalCommission,
      avg_target_achievement: targetAchievement,
      recent_transactions_count: mentorTransactions.filter(t => {
        const txDate = new Date(t.requested_at);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return txDate > thirtyDaysAgo;
      }).length
    });
  }, [currentUser, transactions, students, targets, ledgers]);

  const trainingTopics = [
    {
      id: 'student_acquisition',
      title: 'Student Acquisition Strategies',
      description: 'Learn effective techniques to attract and onboard new students',
      icon: Users,
      color: 'bg-blue-100 text-blue-800',
      recommendedFor: ['low_students', 'low_acquisition']
    },
    {
      id: 'student_engagement',
      title: 'Student Engagement & Retention',
      description: 'Keep your students active and motivated for long-term success',
      icon: Target,
      color: 'bg-purple-100 text-purple-800',
      recommendedFor: ['low_retention', 'inactive_students']
    },
    {
      id: 'funding_optimization',
      title: 'Funding & Transaction Optimization',
      description: 'Maximize student deposits and optimize transaction workflows',
      icon: DollarSign,
      color: 'bg-emerald-100 text-emerald-800',
      recommendedFor: ['low_deposits', 'low_transactions']
    },
    {
      id: 'performance_tracking',
      title: 'Performance Analytics & Goal Setting',
      description: 'Master data-driven decision making and target achievement',
      icon: TrendingUp,
      color: 'bg-amber-100 text-amber-800',
      recommendedFor: ['low_target_achievement']
    },
    {
      id: 'advanced_mentoring',
      title: 'Advanced Mentoring Techniques',
      description: 'Elite strategies for high-performing mentors',
      icon: Award,
      color: 'bg-indigo-100 text-indigo-800',
      recommendedFor: ['high_performer']
    }
  ];

  const generateTrainingModule = async (topic) => {
    setIsGenerating(true);
    try {
      // Check if module already exists
      const existingProgress = trainingProgress.find(
        p => p.mentor_id === currentUser.id && p.topic_id === topic.id
      );
      
      if (existingProgress) {
        toast.info('This module has already been generated. Check My Learning.');
        setIsGenerating(false);
        return;
      }
      // Determine performance level
      let performanceLevel = 'intermediate';
      if (performanceData) {
        if (performanceData.active_students < 5 || performanceData.avg_target_achievement < 50) {
          performanceLevel = 'beginner';
        } else if (performanceData.active_students >= 15 && performanceData.avg_target_achievement >= 80) {
          performanceLevel = 'advanced';
        }
      }

      // Generate training module
      const moduleResult = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert training content creator for a trading mentorship platform. Generate a comprehensive training module on "${topic.title}".

Performance Context:
- Active Students: ${performanceData?.active_students || 0}
- Net Deposit: $${performanceData?.total_net_deposit || 0}
- Target Achievement: ${performanceData?.avg_target_achievement || 0}%
- Recent Activity: ${performanceData?.recent_transactions_count || 0} transactions (30 days)
- Performance Level: ${performanceLevel}

Create a detailed training module with:
1. Introduction (why this topic matters)
2. 5-7 key learning objectives
3. Main content sections (3-5 sections with detailed explanations, examples, and actionable tips)
4. Best practices and common pitfalls
5. Action items for immediate implementation

Tailor the content to the mentor's ${performanceLevel} level. Use practical examples relevant to trading mentorship.`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            introduction: { type: "string" },
            learning_objectives: {
              type: "array",
              items: { type: "string" }
            },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section_title: { type: "string" },
                  content: { type: "string" }
                }
              }
            },
            best_practices: {
              type: "array",
              items: { type: "string" }
            },
            common_pitfalls: {
              type: "array",
              items: { type: "string" }
            },
            action_items: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      // Generate quiz
      const quizResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Based on this training module about "${topic.title}", create a 5-question assessment quiz.

Module Content:
${JSON.stringify(moduleResult, null, 2)}

Create 5 multiple-choice questions that test understanding of the key concepts. Each question should have 4 options with only 1 correct answer.`,
        response_json_schema: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  options: {
                    type: "array",
                    items: { type: "string" }
                  },
                  correct_answer_index: { type: "number" },
                  explanation: { type: "string" }
                }
              }
            }
          }
        }
      });

      // Save to database
      const progressData = {
        mentor_id: currentUser.id,
        mentor_name: currentUser.full_name,
        topic_id: topic.id,
        topic_title: topic.title,
        module_data: JSON.stringify(moduleResult),
        quiz_data: JSON.stringify(quizResult),
        completed: false,
        generated_at: new Date().toISOString()
      };

      await base44.entities.TrainingProgress.create(progressData);
      await refetchProgress();
      toast.success('Training module generated successfully!');
    } catch (error) {
      console.error('Generation error:', error);
      toast.error('Failed to generate training module');
    } finally {
      setIsGenerating(false);
    }
  };

  const getRecommendedTopics = () => {
    if (!performanceData) return [];

    const recommended = [];
    
    if (performanceData.active_students < 5) {
      recommended.push('student_acquisition');
    }
    if (performanceData.recent_transactions_count < 10) {
      recommended.push('student_engagement');
    }
    if (performanceData.total_net_deposit < 10000) {
      recommended.push('funding_optimization');
    }
    if (performanceData.avg_target_achievement < 70) {
      recommended.push('performance_tracking');
    }
    if (performanceData.active_students >= 15 && performanceData.avg_target_achievement >= 80) {
      recommended.push('advanced_mentoring');
    }

    return recommended;
  };

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const isMentor = ['junior_mentor', 'senior_mentor'].includes(currentUser.app_role);

  if (!isMentor) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <BookOpen className="h-12 w-12 text-yellow-600 mx-auto mb-3" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Mentors Only</h2>
          <p className="text-gray-600">This training section is available for mentors only.</p>
        </div>
      </div>
    );
  }

  const recommendedTopicIds = getRecommendedTopics();

  // Filter progress for current mentor
  const myProgress = trainingProgress.filter(p => p.mentor_id === currentUser.id);

  // Determine which modules are unlocked
  const getUnlockedModules = () => {
    const completedTopics = myProgress
      .filter(p => p.completed && p.quiz_percentage >= 80)
      .map(p => p.topic_id);
    
    return trainingTopics.map((topic, index) => {
      // First module is always unlocked
      if (index === 0) return { ...topic, isUnlocked: true };
      
      // Check if previous module is completed
      const previousTopic = trainingTopics[index - 1];
      const isPreviousCompleted = completedTopics.includes(previousTopic.id);
      
      return { ...topic, isUnlocked: isPreviousCompleted };
    });
  };

  const unlockedTopics = getUnlockedModules();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/50 via-indigo-50/40 to-purple-100/30 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
              <BookOpen className="h-9 w-9 text-blue-600" />
              Mentor Training Resources
            </h1>
            <p className="text-gray-600 mt-2 text-base">AI-powered personalized training modules</p>
          </div>
        </div>

        {/* Performance Overview */}
        {performanceData && (
          <Card className="border-none shadow-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold text-white">Your Performance Snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/95 backdrop-blur-sm rounded-xl p-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-blue-600" />
                    <span className="text-xs text-gray-700 font-medium">Active Students</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{performanceData.active_students}</p>
                </div>
                <div className="bg-white/95 backdrop-blur-sm rounded-xl p-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs text-gray-700 font-medium">Net Deposit</span>
                  </div>
                  <p className="text-2xl font-bold text-emerald-600">${performanceData.total_net_deposit.toFixed(0)}</p>
                </div>
                <div className="bg-white/95 backdrop-blur-sm rounded-xl p-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs text-gray-700 font-medium">Target Achievement</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-600">{performanceData.avg_target_achievement.toFixed(0)}%</p>
                </div>
                <div className="bg-white/95 backdrop-blur-sm rounded-xl p-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="h-4 w-4 text-purple-600" />
                    <span className="text-xs text-gray-700 font-medium">Recent Activity</span>
                  </div>
                  <p className="text-2xl font-bold text-purple-600">{performanceData.recent_transactions_count}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="modules" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="modules">Training Modules</TabsTrigger>
            <TabsTrigger value="my-learning">My Learning</TabsTrigger>
          </TabsList>

          {/* Training Modules Tab */}
          <TabsContent value="modules" className="space-y-6">
            {recommendedTopicIds.length > 0 && (
              <Card className="border-gray-200">
                <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50">
                  <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
                    <Brain className="h-5 w-5 text-amber-600" />
                    Recommended for You
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-amber-800 mb-4">
                    Based on your performance, we recommend focusing on these areas:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {unlockedTopics
                      .filter(topic => recommendedTopicIds.includes(topic.id))
                      .map(topic => (
                        <TrainingModuleCard
                          key={topic.id}
                          topic={topic}
                          onGenerate={generateTrainingModule}
                          isGenerating={isGenerating}
                          isRecommended={true}
                          isLocked={!topic.isUnlocked}
                        />
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">All Training Topics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {unlockedTopics.map(topic => (
                  <TrainingModuleCard
                    key={topic.id}
                    topic={topic}
                    onGenerate={generateTrainingModule}
                    isGenerating={isGenerating}
                    isRecommended={recommendedTopicIds.includes(topic.id)}
                    isLocked={!topic.isUnlocked}
                  />
                ))}
              </div>
            </div>
          </TabsContent>

          {/* My Learning Tab */}
          <TabsContent value="my-learning" className="space-y-6">
            {myProgress.length > 0 ? (
              <div className="space-y-4">
                {myProgress.map(progress => {
                  const topic = trainingTopics.find(t => t.id === progress.topic_id);
                  return (
                    <Card 
                      key={progress.id} 
                      className="border-gray-200 hover:border-blue-300 transition-colors cursor-pointer"
                      onClick={() => {
                        const moduleData = {
                          id: progress.id,
                          topic: topic,
                          module: JSON.parse(progress.module_data),
                          quiz: JSON.parse(progress.quiz_data),
                          generatedAt: progress.generated_at,
                          completed: progress.completed,
                          progressRecord: progress
                        };
                        setSelectedModule(moduleData);
                      }}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-lg ${topic?.color || 'bg-gray-100 text-gray-800'}`}>
                              {topic && <topic.icon className="h-6 w-6" />}
                            </div>
                            <div>
                              <h3 className="font-semibold text-gray-900">{progress.topic_title}</h3>
                              <p className="text-sm text-gray-600">
                                Generated {new Date(progress.generated_at).toLocaleDateString()}
                              </p>
                              {progress.quiz_score !== undefined && (
                                <p className="text-sm font-medium text-blue-600 mt-1">
                                  Quiz Score: {progress.quiz_score}/{progress.quiz_total} ({progress.quiz_percentage?.toFixed(0)}%)
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {progress.completed ? (
                              <Badge className="bg-green-100 text-green-800">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Completed
                              </Badge>
                            ) : (
                              <Badge variant="outline">In Progress</Badge>
                            )}
                            <Button size="sm">
                              <PlayCircle className="h-4 w-4 mr-1" />
                              Continue
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="border-gray-200">
                <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
                  <CardTitle className="text-lg font-semibold tracking-tight">No Modules Yet</CardTitle>
                </CardHeader>
                <CardContent className="p-12 text-center">
                  <BookOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">No Modules Yet</h3>
                  <p className="text-gray-600 mb-4">
                    Generate your first AI-powered training module from the "Training Modules" tab
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Module Viewer */}
        {selectedModule && (
          <TrainingModuleViewer
            module={selectedModule}
            onClose={() => setSelectedModule(null)}
            onComplete={async (moduleId, score, total, percentage) => {
              // Update progress in database
              await base44.entities.TrainingProgress.update(moduleId, {
                completed: true,
                quiz_score: score,
                quiz_total: total,
                quiz_percentage: percentage,
                completed_at: new Date().toISOString()
              });
              await refetchProgress();
              setSelectedModule(null);
            }}
          />
        )}
      </div>
    </div>
  );
}