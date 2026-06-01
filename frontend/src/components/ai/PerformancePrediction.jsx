import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, DollarSign, Award, Target } from "lucide-react";

export default function PerformancePrediction({ insights }) {
  const { analysis } = insights;
  const prediction = analysis.next_quarter_prediction;

  const getConfidenceColor = (confidence) => {
    if (confidence.toLowerCase().includes('high')) {
      return 'bg-green-100 text-green-800 border-green-200';
    } else if (confidence.toLowerCase().includes('medium')) {
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    }
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl flex items-center gap-2">
            <Target className="h-6 w-6 text-blue-600" />
            Next Quarter Predictions
          </CardTitle>
          <Badge variant="outline" className={getConfidenceColor(prediction.confidence)}>
            {prediction.confidence} Confidence
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl p-6 border border-blue-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <DollarSign className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Predicted Net Deposit</p>
                <p className="text-3xl font-bold text-emerald-600">
                  ${prediction.predicted_net_deposit.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <TrendingUp className="h-4 w-4" />
              <span>Based on historical trends and current trajectory</span>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-blue-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Award className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Predicted Commission</p>
                <p className="text-3xl font-bold text-blue-600">
                  ${prediction.predicted_commission.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <TrendingUp className="h-4 w-4" />
              <span>Estimated based on 4% commission rate</span>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-100 rounded-lg border border-blue-300">
          <p className="text-sm text-blue-900">
            <strong>Note:</strong> These predictions are AI-generated estimates based on historical data and current trends. 
            Actual results may vary based on market conditions, student acquisition, and mentor activity.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}