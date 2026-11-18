// GameCore/IEnemyDetector.cs
// Reconstructed from IL2CPP metadata v23 (Il2CppUserAssemblies.elf).
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Detection/attack volume used by towers to find enemies. Implemented by the in-scope
// EnemyDetectorSphere and EnemyDetectorCone. Added here as the supporting interface for
// those detectors. Interface slot numbers from the skeleton; no bodies (interface).

using UnityEngine;

namespace GameCore
{
    public interface IEnemyDetector
    {
        Vector3 GetOffset();                                  // Slot 0
        float GetAnchorV();                                   // Slot 1
        bool InDetection(Vector3 pos, GameCoreObject other);  // Slot 2
        bool InDetection(Vector3 pos, Vector3 otherPos);      // Slot 3
        bool InAttack(Vector3 pos, GameCoreObject other);     // Slot 4
        bool InAttack(Vector3 pos, Vector3 otherPos);         // Slot 5
        Cylinder GetCollisionCylinder();                      // Slot 6
        Cylinder GetAffectCylinder();                         // Slot 7
        void Upgrade(float scale, float affectScale);         // Slot 8
        float GetRadiusScale();                               // Slot 9
    }
}