"use client";

import Nebula from "@/components/Nebula";
import Clock from "@/components/Clock";
import SchedulePanel from "@/components/SchedulePanel";
import WeatherPanel from "@/components/WeatherPanel";
import NotificationsPanel from "@/components/NotificationsPanel";
import VoiceControl from "@/components/VoiceControl";
import { useVoice } from "@/contexts/VoiceContext";

export default function Home() {
  const { level, status } = useVoice();

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto grid h-full max-w-6xl gap-4 lg:grid-cols-[280px_1fr_280px] lg:grid-rows-[auto_auto_auto]">
        <div className="glass-panel lg:col-start-1 lg:row-start-1">
          <Clock />
        </div>
        <div className="glass-panel lg:col-start-3 lg:row-start-1">
          <WeatherPanel />
        </div>

        <div className="relative order-first min-h-[320px] lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Nebula level={level} status={status} />
        </div>

        <div className="glass-panel lg:col-start-1 lg:row-start-2">
          <SchedulePanel />
        </div>
        <div className="glass-panel lg:col-start-3 lg:row-start-2">
          <NotificationsPanel />
        </div>

        <div className="glass-panel lg:col-span-3 lg:row-start-3">
          <VoiceControl />
        </div>
      </div>
    </div>
  );
}
