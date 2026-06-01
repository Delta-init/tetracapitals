import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Users, Flame, Trophy, Award, TrendingUp, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function PointsGuide({ settings = [] }) {
  const pointsPer100USD = settings.find(s => s.setting_key === 'points_per_100_usd')?.setting_value || 1;
  const pointsPerStudent = settings.find(s => s.setting_key === 'points_per_student')?.setting_value || 100;
  const minDepositForStudent = settings.find(s => s.setting_key === 'min_deposit_for_student_points')?.setting_value || 500;
  const streakBonusPerWeek = settings.find(s => s.setting_key === 'streak_bonus_per_week')?.setting_value || 50;

  const badges = [
    {
      category: "Deposit Milestones",
      icon: <DollarSign className="h-5 w-5" />,
      items: [
        { name: "First Deposit", requirement: "Your first approved deposit", color: "bg-blue-100 text-blue-800" },
        { name: "$10K Club", requirement: "$10,000 net deposit", color: "bg-green-100 text-green-800" },
        { name: "$50K Master", requirement: "$50,000 net deposit", color: "bg-emerald-100 text-emerald-800" },
        { name: "$100K Elite", requirement: "$100,000 net deposit", color: "bg-teal-100 text-teal-800" },
        { name: "$250K Legend", requirement: "$250,000 net deposit", color: "bg-purple-100 text-purple-800" }
      ]
    },
    {
      category: "Student Growth",
      icon: <Users className="h-5 w-5" />,
      items: [
        { name: "Team Builder", requirement: "5 depositing students (min $500 each)", color: "bg-blue-100 text-blue-800" },
        { name: "Network Pro", requirement: "10 depositing students (min $500 each)", color: "bg-indigo-100 text-indigo-800" },
        { name: "Community Leader", requirement: "25+ depositing students (min $500 each)", color: "bg-violet-100 text-violet-800" }
      ]
    },
    {
      category: "Consistency Streaks",
      icon: <Flame className="h-5 w-5" />,
      items: [
        { name: "On Fire", requirement: "4 consecutive weeks with deposits", color: "bg-orange-100 text-orange-800" },
        { name: "Unstoppable", requirement: "8 consecutive weeks with deposits", color: "bg-red-100 text-red-800" },
        { name: "Legend Status", requirement: "12+ consecutive weeks with deposits", color: "bg-rose-100 text-rose-800" }
      ]
    }
  ];

  return (
    <div className="space-y-6">
      {/* How Points Are Earned */}
      <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-blue-600" />
            How to Earn Points
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4 border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                <h3 className="font-semibold text-gray-900">Deposit Points</h3>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Earn <span className="font-bold text-blue-600">{pointsPer100USD} point</span> for every <span className="font-bold">$100 USD</span> in net deposits
              </p>
              <p className="text-xs text-gray-500 italic">
                Example: $5,000 net deposit = {(5000 / 100) * pointsPer100USD} points
              </p>
            </div>

            <div className="bg-white rounded-lg p-4 border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Student Points</h3>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Earn <span className="font-bold text-blue-600">{pointsPerStudent} points</span> per unique student with <span className="font-bold">min ${minDepositForStudent}</span> net deposit
              </p>
              <p className="text-xs text-gray-500 italic">
                Example: 5 students = {5 * pointsPerStudent} points
              </p>
            </div>

            <div className="bg-white rounded-lg p-4 border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="h-5 w-5 text-orange-600" />
                <h3 className="font-semibold text-gray-900">Streak Bonus</h3>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Earn <span className="font-bold text-orange-600">{streakBonusPerWeek} points/week</span> for <span className="font-bold">4+ consecutive weeks</span> with deposits
              </p>
              <p className="text-xs text-gray-500 italic">
                Example: 8-week streak = {8 * streakBonusPerWeek} bonus points
              </p>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex gap-3">
            <Info className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-yellow-900 mb-1">Points Calculation</p>
              <p className="text-yellow-800">
                <strong>Total Points = Deposit Points + Student Points + Streak Bonus</strong>
              </p>
              <p className="text-yellow-700 mt-2">
                Only approved deposits and withdrawals count toward your points. Net deposit = Total Deposits - Total Withdrawals
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Badge Requirements */}
      <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="h-5 w-5 text-purple-600" />
            Badge Requirements
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {badges.map((badgeCategory, idx) => (
            <div key={idx}>
              <div className="flex items-center gap-2 mb-3">
                <div className="text-purple-600">{badgeCategory.icon}</div>
                <h3 className="font-semibold text-gray-900">{badgeCategory.category}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {badgeCategory.items.map((badge, badgeIdx) => (
                  <div key={badgeIdx} className="bg-white rounded-lg p-3 border border-gray-200 hover:shadow-md transition-shadow">
                    <Badge className={`${badge.color} mb-2`}>
                      {badge.name}
                    </Badge>
                    <p className="text-xs text-gray-600">{badge.requirement}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex gap-3">
            <TrendingUp className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-purple-900 mb-1">Badge Progression</p>
              <p className="text-purple-800">
                Badges are automatically awarded when you meet the requirements. You'll earn the highest badge in each category - keep pushing to unlock the next level!
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}