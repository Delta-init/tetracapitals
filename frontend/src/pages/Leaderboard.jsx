import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Medal, Award, TrendingUp, Users, DollarSign, Flame, RefreshCw, Info } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import BadgeDisplay from "../components/gamification/BadgeDisplay";
import PointsGuide from "../components/gamification/PointsGuide";
import { calculateMentorPoints, calculateStreakBonus, awardBadges, calculateWeeklyStreak } from "../components/utils/GamificationUtils";
import { toast } from "sonner";
import { logAction } from "../components/utils/AuditLogger";

export default function Leaderboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: mentorPoints = [] } = useQuery({
    queryKey: ['mentor-points'],
    queryFn: () => base44.entities.MentorPoints.list('-total_points'),
    enabled: !!currentUser
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions-gamification'],
    queryFn: () => base44.entities.FundingTransaction.list(),
    enabled: !!currentUser
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['gamification-settings'],
    queryFn: () => base44.entities.GamificationSettings.list(),
    enabled: !!currentUser
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-leaderboard'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser
  });

  const updatePointsMutation = useMutation({
    mutationFn: async (pointsData) => {
      if (pointsData.id) {
        return base44.entities.MentorPoints.update(pointsData.id, pointsData);
      } else {
        return base44.entities.MentorPoints.create(pointsData);
      }
    }
  });

  const recalculateAllPoints = async () => {
    setIsRecalculating(true);
    try {
      const mentors = users.filter(u => ['junior_mentor', 'senior_mentor'].includes(u.app_role));
      
      for (const mentor of mentors) {
        const points = calculateMentorPoints(mentor.id, transactions, settings);
        const streak = calculateWeeklyStreak(mentor.id, transactions);
        const streakBonus = calculateStreakBonus(streak.current, settings);
        
        const totalPoints = points.deposit_points + points.student_points + streakBonus;
        
        const badges = awardBadges({
          total_net_deposit_usd: points.total_net_deposit_usd,
          unique_depositing_students: points.unique_depositing_students,
          current_streak_weeks: streak.current
        });

        const existingRecord = mentorPoints.find(mp => mp.mentor_id === mentor.id);
        
        const pointsData = {
          mentor_id: mentor.id,
          mentor_name: mentor.full_name,
          total_points: totalPoints,
          deposit_points: points.deposit_points,
          student_points: points.student_points,
          bonus_points: streakBonus,
          total_net_deposit_usd: points.total_net_deposit_usd,
          unique_depositing_students: points.unique_depositing_students,
          current_streak_weeks: streak.current,
          longest_streak_weeks: Math.max(streak.longest, existingRecord?.longest_streak_weeks || 0),
          badges: badges,
          last_calculated_date: new Date().toISOString(),
          id: existingRecord?.id
        };

        await updatePointsMutation.mutateAsync(pointsData);
      }

      // Assign ranks
      await queryClient.invalidateQueries(['mentor-points']);
      await logAction('recalculate_leaderboard', 'MentorPoints', null, 'Recalculated entire leaderboard', null, null);
      toast.success('Leaderboard recalculated successfully!');
    } catch (error) {
      toast.error('Failed to recalculate leaderboard');
      console.error(error);
    } finally {
      setIsRecalculating(false);
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

  // Assign ranks
  const rankedMentors = [...mentorPoints]
    .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
    .map((mentor, index) => ({ ...mentor, rank: index + 1 }));

  const topThree = rankedMentors.slice(0, 3);
  const currentMentorRank = rankedMentors.find(m => m.mentor_id === currentUser.id);

  const canRecalculate = ['super_admin', 'academic_head'].includes(currentUser.app_role);

  const getRankIcon = (rank) => {
    switch (rank) {
      case 1: return <Trophy className="h-6 w-6 text-yellow-500" />;
      case 2: return <Medal className="h-6 w-6 text-gray-400" />;
      case 3: return <Medal className="h-6 w-6 text-amber-600" />;
      default: return <Award className="h-5 w-5 text-gray-400" />;
    }
  };

  const getRankColor = (rank) => {
    switch (rank) {
      case 1: return 'bg-gradient-to-r from-yellow-100 to-yellow-50 border-yellow-300';
      case 2: return 'bg-gradient-to-r from-gray-100 to-gray-50 border-gray-300';
      case 3: return 'bg-gradient-to-r from-amber-100 to-amber-50 border-amber-300';
      default: return 'bg-white border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3 tracking-tight">
              <Trophy className="h-9 w-9 text-yellow-500" />
              Mentor Leaderboard
            </h1>
            <p className="text-gray-600 mt-2 text-base">Compete, achieve, and earn rewards!</p>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              onClick={() => setShowGuide(true)}
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              <Info className="h-4 w-4 mr-2" />
              How to Earn Points
            </Button>
            {canRecalculate && (
              <Button 
                onClick={recalculateAllPoints} 
                disabled={isRecalculating}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRecalculating ? 'animate-spin' : ''}`} />
                {isRecalculating ? 'Recalculating...' : 'Recalculate All'}
              </Button>
            )}
          </div>
        </div>

        {/* Current User's Rank Card */}
        {currentMentorRank && (
          <Card className="border-2 border-blue-500 bg-gradient-to-r from-blue-50 to-indigo-50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-600 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold">
                    #{currentMentorRank.rank}
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Your Rank</p>
                    <p className="text-2xl font-bold text-gray-900">{currentMentorRank.mentor_name}</p>
                    <p className="text-lg text-blue-600 font-semibold">{currentMentorRank.total_points?.toLocaleString()} points</p>
                  </div>
                </div>
                <div className="text-right">
                  <BadgeDisplay badges={currentMentorRank.badges} size="large" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top 3 Podium */}
        {topThree.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {topThree.map((mentor, index) => (
              <Card key={mentor.id} className={`border-2 ${getRankColor(mentor.rank)}`}>
                <CardHeader className="text-center pb-3">
                  <div className="flex justify-center mb-2">
                    {getRankIcon(mentor.rank)}
                  </div>
                  <CardTitle className="text-lg">
                    <div className="text-sm text-gray-600 font-normal">Rank #{mentor.rank}</div>
                    <div className="font-bold">{mentor.mentor_name}</div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-blue-600">{mentor.total_points?.toLocaleString()}</p>
                    <p className="text-sm text-gray-600">Total Points</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-center p-2 bg-white rounded-lg">
                      <DollarSign className="h-4 w-4 mx-auto text-emerald-600" />
                      <p className="font-semibold">${(mentor.total_net_deposit_usd || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Net Deposit</p>
                    </div>
                    <div className="text-center p-2 bg-white rounded-lg">
                      <Users className="h-4 w-4 mx-auto text-blue-600" />
                      <p className="font-semibold">{mentor.unique_depositing_students || 0}</p>
                      <p className="text-xs text-gray-500">Students</p>
                    </div>
                  </div>
                  {mentor.current_streak_weeks > 0 && (
                    <div className="text-center p-2 bg-orange-50 rounded-lg">
                      <Flame className="h-4 w-4 mx-auto text-orange-600" />
                      <p className="font-semibold text-orange-600">{mentor.current_streak_weeks} weeks</p>
                      <p className="text-xs text-gray-600">Current Streak</p>
                    </div>
                  )}
                  <div className="flex justify-center pt-2">
                    <BadgeDisplay badges={mentor.badges} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Full Leaderboard Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Full Rankings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold w-16">Rank</TableHead>
                    <TableHead className="font-semibold">Mentor</TableHead>
                    <TableHead className="font-semibold text-right">Total Points</TableHead>
                    <TableHead className="font-semibold text-right">Deposit Points</TableHead>
                    <TableHead className="font-semibold text-right">Student Points</TableHead>
                    <TableHead className="font-semibold text-right">Bonus Points</TableHead>
                    <TableHead className="font-semibold text-right">Net Deposit</TableHead>
                    <TableHead className="font-semibold text-right">Students</TableHead>
                    <TableHead className="font-semibold text-center">Streak</TableHead>
                    <TableHead className="font-semibold">Badges</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankedMentors.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                        No leaderboard data yet. Click "Recalculate All" to generate rankings.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rankedMentors.map((mentor) => (
                      <TableRow 
                        key={mentor.id} 
                        className={`hover:bg-gray-50 transition-colors ${mentor.mentor_id === currentUser.id ? 'bg-blue-50' : ''}`}
                      >
                        <TableCell className="font-bold">
                          <div className="flex items-center gap-2">
                            {getRankIcon(mentor.rank)}
                            #{mentor.rank}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{mentor.mentor_name}</TableCell>
                        <TableCell className="text-right font-bold text-blue-600">
                          {mentor.total_points?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-right">{mentor.deposit_points?.toLocaleString() || 0}</TableCell>
                        <TableCell className="text-right">{mentor.student_points?.toLocaleString() || 0}</TableCell>
                        <TableCell className="text-right">{mentor.bonus_points?.toLocaleString() || 0}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600">
                          ${mentor.total_net_deposit_usd?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-right font-semibold">{mentor.unique_depositing_students || 0}</TableCell>
                        <TableCell className="text-center">
                          {mentor.current_streak_weeks > 0 ? (
                            <div className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
                              <Flame className="h-3 w-3" />
                              {mentor.current_streak_weeks}w
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <BadgeDisplay badges={mentor.badges} size="small" />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Points & Badge Guide Dialog */}
        <Dialog open={showGuide} onOpenChange={setShowGuide}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl flex items-center gap-2">
                <Trophy className="h-6 w-6 text-yellow-500" />
                Points & Badge System Guide
              </DialogTitle>
            </DialogHeader>
            <PointsGuide settings={settings} />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}