import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Lock } from "lucide-react";

export default function TrainingModuleCard({ topic, onGenerate, isGenerating, isRecommended, isLocked }) {
  return (
    <Card className={`border-none shadow-lg hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] bg-white/80 backdrop-blur-sm ${isRecommended ? 'ring-2 ring-amber-400 shadow-amber-500/20' : ''} ${isLocked ? 'opacity-60' : ''}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className={`p-3 rounded-lg ${topic.color}`}>
            {topic.icon && <topic.icon className="h-6 w-6" />}
          </div>
          <div className="flex gap-2">
            {isRecommended && (
              <Badge className="bg-amber-100 text-amber-800">
                <Sparkles className="h-3 w-3 mr-1" />
                Recommended
              </Badge>
            )}
            {isLocked && (
              <Badge className="bg-gray-100 text-gray-800">
                <Lock className="h-3 w-3 mr-1" />
                Locked
              </Badge>
            )}
          </div>
        </div>
        <CardTitle className="text-lg mt-3">{topic.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">{topic.description}</p>
        {isLocked ? (
          <Button disabled className="w-full">
            <Lock className="h-4 w-4 mr-2" />
            Complete Previous Module
          </Button>
        ) : (
          <Button
            onClick={() => onGenerate(topic)}
            disabled={isGenerating}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate AI Module
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}