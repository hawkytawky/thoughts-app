import { useCallback, useEffect } from "react";
import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import {
  isWeeklyBriefingNotification,
  registerCurrentPushInstallation,
} from "@/lib/push-notifications";

export function NotificationBootstrap() {
  const router = useRouter();
  const openNotification = useCallback(
    (response: Notifications.NotificationResponse | null) => {
      if (!isWeeklyBriefingNotification(response)) return;
      router.replace("/overview?view=base" as Href);
    },
    [router],
  );

  useEffect(() => {
    void registerCurrentPushInstallation().catch((error: unknown) => {
      if (__DEV__) console.error("Failed to register push notifications", error);
    });

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(openNotification);
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      void registerCurrentPushInstallation().catch((error: unknown) => {
        if (__DEV__) console.error("Failed to refresh push registration", error);
      });
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      openNotification(response);
      if (response) void Notifications.clearLastNotificationResponseAsync();
    });

    return () => {
      responseSubscription.remove();
      tokenSubscription.remove();
    };
  }, [openNotification]);

  return null;
}
