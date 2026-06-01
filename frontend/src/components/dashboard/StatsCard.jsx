import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function StatsCard({ title, value, icon: Icon, color, trend, trendUp, delay = 0 }) {
  const colorClasses = {
    blue: 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30',
    emerald: 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30',
    purple: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-lg shadow-purple-500/30',
    amber: 'bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/30',
    red: 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30'
  };

  return (
    <Card className="border-none shadow-xl hover:shadow-2xl transition-all duration-300 bg-white/80 backdrop-blur-sm hover:scale-[1.02] group cursor-pointer">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600 mb-1 transition-all duration-300 group-hover:text-gray-800">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mb-1 transition-all duration-300 group-hover:scale-105">{value}</p>
            {trend && (
              <div className="flex items-center gap-1 mt-2">
                {trendUp !== undefined && (
                  trendUp ? <TrendingUp className="h-3 w-3 text-emerald-600 transition-transform duration-300 group-hover:translate-y-[-2px]" /> : <TrendingDown className="h-3 w-3 text-gray-400" />
                )}
                <p className={`text-xs ${trendUp ? 'text-emerald-600' : 'text-gray-500'} transition-all duration-300`}>
                  {trend}
                </p>
              </div>
            )}
          </div>
          <div className={`p-4 rounded-2xl ${colorClasses[color]} transition-all duration-300 group-hover:scale-110 group-hover:rotate-3`}>
            <Icon className="h-7 w-7 transition-transform duration-300 group-hover:scale-110" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}