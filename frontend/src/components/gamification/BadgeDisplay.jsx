import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Award, TrendingUp, Zap, Star, Target, Trophy, Crown, Flame } from 'lucide-react';

const BADGE_DEFINITIONS = {
  first_deposit: { name: "First Blood", icon: Award, color: "bg-blue-100 text-blue-800", description: "First student deposit" },
  deposit_10k: { name: "Silver Trader", icon: Trophy, color: "bg-gray-300 text-gray-800", description: "$10,000 in deposits" },
  deposit_50k: { name: "Gold Trader", icon: Trophy, color: "bg-yellow-400 text-yellow-900", description: "$50,000 in deposits" },
  deposit_100k: { name: "Platinum Trader", icon: Crown, color: "bg-purple-400 text-purple-900", description: "$100,000 in deposits" },
  deposit_250k: { name: "Diamond Trader", icon: Crown, color: "bg-cyan-400 text-cyan-900", description: "$250,000 in deposits" },
  student_5: { name: "Recruiter", icon: Star, color: "bg-green-100 text-green-800", description: "5 depositing students" },
  student_10: { name: "Super Recruiter", icon: Star, color: "bg-green-300 text-green-900", description: "10 depositing students" },
  student_25: { name: "Elite Recruiter", icon: Star, color: "bg-emerald-400 text-emerald-900", description: "25 depositing students" },
  streak_4: { name: "On Fire", icon: Flame, color: "bg-orange-100 text-orange-800", description: "4 week streak" },
  streak_8: { name: "Blazing", icon: Flame, color: "bg-orange-400 text-orange-900", description: "8 week streak" },
  streak_12: { name: "Inferno", icon: Flame, color: "bg-red-500 text-white", description: "12 week streak" },
  rising_star: { name: "Rising Star", icon: TrendingUp, color: "bg-pink-100 text-pink-800", description: "Fast growth" },
  top_converter: { name: "Conversion King", icon: Target, color: "bg-indigo-100 text-indigo-800", description: "High conversion rate" },
  monthly_champion: { name: "Monthly Champion", icon: Zap, color: "bg-yellow-100 text-yellow-800", description: "Top performer this month" }
};

export default function BadgeDisplay({ badges, size = "default" }) {
  if (!badges || badges.length === 0) {
    return <span className="text-sm text-gray-400">No badges yet</span>;
  }

  const sizeClasses = {
    small: "h-6 w-6",
    default: "h-8 w-8",
    large: "h-10 w-10"
  };

  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badgeId) => {
        const badge = BADGE_DEFINITIONS[badgeId];
        if (!badge) return null;
        
        const Icon = badge.icon;
        
        return (
          <div key={badgeId} className="group relative">
            <div className={`${badge.color} ${sizeClasses[size]} rounded-full flex items-center justify-center border-2 border-white shadow-md hover:scale-110 transition-transform cursor-pointer`}>
              <Icon className={size === 'small' ? 'h-3 w-3' : size === 'large' ? 'h-5 w-5' : 'h-4 w-4'} />
            </div>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-10">
              <div className="bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap">
                <div className="font-semibold">{badge.name}</div>
                <div className="text-gray-300">{badge.description}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { BADGE_DEFINITIONS };