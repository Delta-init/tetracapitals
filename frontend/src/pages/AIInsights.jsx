import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  Lightbulb, 
  Target, 
  Users,
  DollarSign,
  Loader2,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import MentorInsightCard from "../components/ai/MentorInsightCard";
import PerformancePrediction from "../components/ai/PerformancePrediction";

export default function AIInsights() {
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedMentor, setSelectedMentor] = useState('all');
  const [insights, setInsights] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [atRiskMentors, setAtRiskMentors] = useState([]);

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
      // Auto-select current user for mentors
      if (['junior_mentor', 'senior_mentor'].includes(user.app_role)) {
        setSelectedMentor(user.id);
      }
    };
    fetchUser();
  }, []);

  const { data: users = [] } = useQuery({
    queryKey: ['users-ai'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions-ai'],
    queryFn: () => base44.entities.FundingTransaction.list(),
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students-ai'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const { data: targets = [] } = useQuery({
    queryKey: ['targets-ai'],
    queryFn: () => base44.entities.MentorTarget.list(),
    enabled: !!currentUser
  });

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers-ai'],
    queryFn: () => base44.entities.CommissionLedger.list(),
    enabled: !!currentUser
  });

  const mentors = users.filter(u => ['junior_mentor', 'senior_mentor'].includes(u.app_role));

  const analyzeMentorPerformance = async (mentorId) => {
    setIsAnalyzing(true);
    try {
      const mentor = mentors.find(m => m.id === mentorId);
      
      // Gather mentor-specific data
      const mentorStudents = students.filter(s => 
        s.primary_mentor_id === mentorId || s.senior_mentor_id === mentorId
      );
      
      const mentorTransactions = transactions.filter(t => 
        t.primary_mentor_id === mentorId || t.senior_mentor_id === mentorId
      );
      
      const mentorTargets = targets.filter(t => t.mentor_id === mentorId);
      const mentorLedgers = ledgers.filter(l => l.mentor_id === mentorId);

      // Calculate key metrics
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

      // Prepare data for AI analysis
      const analysisData = {
        mentor_name: mentor.full_name,
        role: mentor.app_role,
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
        }).length,
        commission_history: mentorLedgers.map(l => ({
          quarter: l.quarter,
          net_deposit: l.net_deposit_usd,
          commission: l.commission_release_usd
        }))
      };

      // Call AI for insights
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an AI performance analyst for a trading mentorship platform. Analyze this mentor's performance data and provide:

1. Performance Trend: Is their performance improving, declining, or stable?
2. Risk Assessment: Are they at risk of underperforming? (Rate: LOW, MEDIUM, HIGH)
3. Key Strengths: What are they doing well?
4. Areas for Improvement: What specific actions should they take?
5. Predictions: What do you predict for their next quarter performance?
6. Recommendations: 3-5 specific, actionable recommendations

Mentor Data:
${JSON.stringify(analysisData, null, 2)}

Consider factors like:
- Student acquisition and retention
- Transaction volume trends
- Target achievement rates
- Commission consistency
- Recent activity levels`,
        response_json_schema: {
          type: "object",
          properties: {
            performance_trend: { 
              type: "string",
              enum: ["improving", "stable", "declining"]
            },
            risk_level: { 
              type: "string",
              enum: ["LOW", "MEDIUM", "HIGH"]
            },
            risk_factors: {
              type: "array",
              items: { type: "string" }
            },
            key_strengths: {
              type: "array",
              items: { type: "string" }
            },
            areas_for_improvement: {
              type: "array",
              items: { type: "string" }
            },
            next_quarter_prediction: {
              type: "object",
              properties: {
                predicted_net_deposit: { type: "number" },
                predicted_commission: { type: "number" },
                confidence: { type: "string" }
              }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string", enum: ["high", "medium", "low"] }
                }
              }
            }
          }
        }
      });

      setInsights({
        mentor,
        data: analysisData,
        analysis: result
      });

      toast.success('Performance analysis completed');
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Failed to analyze performance');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analyzeAllMentors = async () => {
    setIsAnalyzing(true);
    try {
      const atRisk = [];

      for (const mentor of mentors) {
        const mentorStudents = students.filter(s => 
          s.primary_mentor_id === mentor.id || s.senior_mentor_id === mentor.id
        );
        
        const mentorTransactions = transactions.filter(t => 
          t.primary_mentor_id === mentor.id || t.senior_mentor_id === mentor.id
        );

        const recentTransactions = mentorTransactions.filter(t => {
          const txDate = new Date(t.requested_at);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return txDate > thirtyDaysAgo;
        }).length;

        const activeStudents = mentorStudents.filter(s => s.status === 'ACTIVE').length;
        
        // Simple risk detection
        const riskFactors = [];
        if (activeStudents === 0) riskFactors.push('No active students');
        if (recentTransactions === 0) riskFactors.push('No recent transactions (30 days)');
        if (mentorStudents.length < 3) riskFactors.push('Low student count');

        if (riskFactors.length >= 2) {
          atRisk.push({
            mentor,
            riskFactors,
            activeStudents,
            recentTransactions
          });
        }
      }

      setAtRiskMentors(atRisk);
      toast.success(`Analysis complete. ${atRisk.length} at-risk mentors identified.`);
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Failed to analyze mentors');
    } finally {
      setIsAnalyzing(false);
    }
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

  const canViewAI = ['super_admin', 'broker_admin', 'academic_head'].includes(currentUser.app_role);
  const isMentor = ['junior_mentor', 'senior_mentor'].includes(currentUser.app_role);

  if (!canViewAI && !isMentor) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <AlertTriangle className="h-12 w-12 text-red-600 mx-auto mb-3" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You don't have permission to view AI insights.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3 tracking-tight">
              <Brain className="h-9 w-9 text-purple-600" />
              AI Performance Insights
            </h1>
            <p className="text-gray-600 mt-2 text-base">AI-powered analysis and predictions for mentor performance</p>
          </div>
          {canViewAI && (
            <Button 
              onClick={analyzeAllMentors}
              disabled={isAnalyzing}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Scan All Mentors
                </>
              )}
            </Button>
          )}
        </div>

        <Tabs defaultValue="insights" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="insights">Individual Insights</TabsTrigger>
            <TabsTrigger value="risk">At-Risk Mentors</TabsTrigger>
          </TabsList>

          {/* Individual Insights Tab */}
          <TabsContent value="insights" className="space-y-6">
            {/* Mentor Selection */}
            <Card className="border-purple-200">
              <CardHeader>
                <CardTitle className="text-lg">Select Mentor for Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <Select 
                    value={selectedMentor} 
                    onValueChange={setSelectedMentor}
                    disabled={isMentor}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Choose a mentor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {isMentor ? (
                        <SelectItem value={currentUser.id}>{currentUser.full_name}</SelectItem>
                      ) : (
                        mentors.map(mentor => (
                          <SelectItem key={mentor.id} value={mentor.id}>
                            {mentor.full_name} ({mentor.app_role})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => analyzeMentorPerformance(isMentor ? currentUser.id : selectedMentor)}
                    disabled={isAnalyzing || (!isMentor && selectedMentor === 'all')}
                    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Brain className="h-4 w-4 mr-2" />
                        Analyze Performance
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-sm text-gray-500">
                  AI will analyze historical data and provide personalized insights and recommendations
                </p>
              </CardContent>
            </Card>

            {/* Insights Display */}
            {insights && (
              <div className="space-y-6">
                <MentorInsightCard insights={insights} />
                <PerformancePrediction insights={insights} />
              </div>
            )}

            {!insights && !isAnalyzing && (
              <Card className="border-gray-200">
                <CardContent className="p-12 text-center">
                  <Brain className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Analysis Yet</h3>
                  <p className="text-gray-600">Select a mentor and click "Analyze Performance" to get started</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* At-Risk Mentors Tab */}
          <TabsContent value="risk" className="space-y-6">
            {atRiskMentors.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {atRiskMentors.map(({ mentor, riskFactors, activeStudents, recentTransactions }) => (
                  <Card key={mentor.id} className="border-red-200 bg-red-50">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{mentor.full_name}</CardTitle>
                        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          At Risk
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Users className="h-4 w-4 text-gray-500" />
                            <span className="text-xs text-gray-600">Active Students</span>
                          </div>
                          <p className="text-2xl font-bold text-gray-900">{activeStudents}</p>
                        </div>
                        <div className="bg-white rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <DollarSign className="h-4 w-4 text-gray-500" />
                            <span className="text-xs text-gray-600">Recent Activity</span>
                          </div>
                          <p className="text-2xl font-bold text-gray-900">{recentTransactions}</p>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-2">Risk Factors:</h4>
                        <ul className="space-y-1">
                          {riskFactors.map((factor, idx) => (
                            <li key={idx} className="text-sm text-red-700 flex items-center gap-2">
                              <AlertTriangle className="h-3 w-3" />
                              {factor}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <Button
                        onClick={() => {
                          setSelectedMentor(mentor.id);
                          analyzeMentorPerformance(mentor.id);
                        }}
                        variant="outline"
                        className="w-full"
                      >
                        <Brain className="h-4 w-4 mr-2" />
                        Get AI Recommendations
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="border-gray-200">
                <CardContent className="p-12 text-center">
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-16 w-16 text-purple-600 mx-auto mb-4 animate-spin" />
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyzing All Mentors...</h3>
                      <p className="text-gray-600">Please wait while we scan for at-risk mentors</p>
                    </>
                  ) : (
                    <>
                      <Target className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">No At-Risk Mentors Found</h3>
                      <p className="text-gray-600 mb-4">Click "Scan All Mentors" to identify mentors who may need support</p>
                      <Button onClick={analyzeAllMentors} className="bg-purple-600 hover:bg-purple-700">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Scan All Mentors
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}