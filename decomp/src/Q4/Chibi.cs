// Q4/Chibi.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
//
// The chibi view — the little creatures that ARE the home's health. The sim side
// lives in GameCoreHome.m_chibisActive (List<GameCoreHome.ChibiData>, deep-copied);
// this MonoBehaviour only renders/animates one chibi and reacts to events:
//   * UnityEvents.chibiKilledEvent (UnityEvent<ChibiData>, fired from the enemy
//     attack presentation path, see EnemyBase.OnEnemyAttack @0x7FFDC0) ->
//     OnEnemyAttackedMe: play Die + death sound, destroy after 1 s.
//   * UnityEvents.stageClearedScreenEvent (int step, bool isPerfect) ->
//     celebration animation on the matching step.
// Movement is purely presentational: chibis hop toward DestPos (set by the Home
// view / ChibiIntro), panic-jump when enemies or the player are close, and are
// projected onto the terrain with linecasts. All float constants below were read
// from the ELF constant pool (addresses noted).
//
// Field offsets / RVAs from skeleton/Q4.cs (TypeDefIndex 2720).

using System.Collections;
using GameCore;
using UnityEngine;

namespace Q4
{
    public class Chibi : MonoBehaviour
    {
        public int ChibiId { get; set; }                        // 0x18 (auto)
        [SerializeField] private AudioClip chibiDeathSound;     // 0x20
        [SerializeField] private AudioClip chibiRunSound;       // 0x28
        [SerializeField] private AudioClip chibiJumpSound;      // 0x30
        [SerializeField] private float randomIdleAnimIntervalMin; // 0x38 (default 10)
        [SerializeField] private float randomIdleAnimIntervalMax; // 0x3C (default 20)
        public Transform Transform { get; protected set; }      // 0x40 (auto)
        public Vector3 DestPos { get; set; }                    // 0x48 (auto)
        public Quaternion DestRot { get; set; }                 // 0x54 (auto)
        public Vector3 LastPos { get; protected set; }          // 0x64 (auto)
        public bool EnableRunSound { get; set; }                // 0x70 (auto)
        public bool IsScared { get; set; }                      // 0x71 (auto)
        public float AccMin;                                    // 0x74 (default 10)
        public float AccMax;                                    // 0x78 (default 50)
        public Vector3 PlayerPos { get; set; }                  // 0x7C (auto)
        public float PanicJumpMinVel { get; set; }              // 0x88 (auto)
        public float PanicJumpMaxVel { get; set; }              // 0x8C (auto)
        private bool m_isOnGround;                              // 0x90
        private float m_jumpDelay;                              // 0x94
        private bool m_isFirstRun;                              // 0x98 (default true)
        private Animator m_Animator;                            // 0xA0
        private Vector3 m_Vel;                                  // 0xA8
        private bool m_IsBeingAttacked;                         // 0xB4
        private Vector3 m_AttackedDestPos;                      // 0xB8
        private bool m_IsDead;                                  // 0xC4
        private float m_DeadTime;                               // 0xC8
        private bool m_IsBlownUp;                               // 0xCC
        private bool m_IsPlayerClose;                           // 0xCD
        private bool m_IsEnemyClose;                            // 0xCE
        private bool m_isDisableJump;                           // 0xCF
        private float m_randomIdleAnimTime;                     // 0xD0
        private AudioSource audioSourceRun;                     // 0xD8

        private static int m_AnimParam_Land;                    // 0x0 (static)
        private static int m_AnimParam_MoveSpeed;               // 0x4 (static)
        private static int m_AnimParam_PanicJump;               // 0x8 (static)
        private static int m_AnimParam_idleVariation;           // 0xC (static)
        private static int m_AnimParam_scared;                  // 0x10 (static)

        public bool IsPlayerClose
        {
            get { return m_IsPlayerClose; }                     // get_IsPlayerClose @0x741630
            set                                                 // set_IsPlayerClose @0x741640
            {
                // Rising edge: schedule a happy jump after a short random delay.
                if (!m_IsPlayerClose && value)
                    m_jumpDelay = Random.Range(0.1f, 1.0f);     // @0x00B7FDA8 / 0x00B7FDAC
                m_IsPlayerClose = value;
            }
        }

        public bool IsEnemyClose
        {
            get { return m_IsEnemyClose; }                      // get_IsEnemyClose @0x741690
            set                                                 // set_IsEnemyClose @0x7416A0
            {
                if (!m_IsEnemyClose && value)
                    m_jumpDelay = Random.Range(0.25f, 1.5f);    // @0x00B7FDB0 / 0x00B7FDB4
                m_IsEnemyClose = value;
            }
        }

        // .cctor @0x741440
        static Chibi()
        {
            m_AnimParam_Land = Animator.StringToHash("Land");
            m_AnimParam_MoveSpeed = Animator.StringToHash("MoveSpeed");
            m_AnimParam_PanicJump = Animator.StringToHash("PanicJump");
            m_AnimParam_idleVariation = Animator.StringToHash("IdleVariation");
            m_AnimParam_scared = Animator.StringToHash("Scared");
        }

        // .ctor @0x741520
        public Chibi()
        {
            randomIdleAnimIntervalMin = 10.0f;                  // 0x41200000
            randomIdleAnimIntervalMax = 20.0f;                  // 0x41A00000
            AccMin = 10.0f;                                     // 0x41200000
            AccMax = 50.0f;                                     // 0x42480000
            m_isFirstRun = true;
        }

        // Awake @0x741750
        private void Awake()
        {
            Transform = GetComponent<Transform>();
            EnableRunSound = true;
            m_randomIdleAnimTime = Random.Range(randomIdleAnimIntervalMin, randomIdleAnimIntervalMax);
            IsScared = false;
        }

        // Start @0x7417C0
        private void Start()
        {
            DestPos = Transform.position;
            LastPos = Transform.position;
            m_Vel = Vector3.zero;
            m_IsPlayerClose = false;
            m_IsBlownUp = false;
            PanicJumpMinVel = 3.0f;                             // 0x40400000
            PanicJumpMaxVel = 5.0f;                             // 0x40A00000

            UnityEvents.chibiKilledEvent.AddListener(OnEnemyAttackedMe);
            UnityEvents.stageClearedScreenEvent.AddListener(OnStageClearedScreen);

            m_Animator = GetComponentInChildren<Animator>();
            if (m_Animator != null)
            {
                m_Animator.SetBool("IdleMirror", Random.Range(0, 2) != 0);
                m_Animator.SetFloat("IdleSpeed", Random.Range(0.8f, 1.2f)); // @0x00B7FDB8 / 0x00B7FDBC
            }
        }

        // OnDestroy @0x741A30
        private void OnDestroy()
        {
            // Faithful nesting: listener removal only happens when the audio
            // singleton exists (as shipped).
            if (MonstersAudio.Instance != null)
            {
                MonstersAudio.Instance.StopSFX(audioSourceRun);
                UnityEvents.chibiKilledEvent.RemoveListener(OnEnemyAttackedMe);
                UnityEvents.stageClearedScreenEvent.RemoveListener(OnStageClearedScreen);
            }
        }

        // OnStageClearedScreen @0x741BA0
        private void OnStageClearedScreen(int a_step, bool a_isPerfect)
        {
            if (!a_isPerfect)
            {
                if (a_step != 0)
                    return;
                StartCoroutine(PlayAnimDelayed(0.0f, "StageClearedNormal"));
            }
            else
            {
                if (a_step != 1)
                    return;
                StartCoroutine(PlayAnimDelayed(1.0f, "StageClearedPerfect"));
            }
        }

        // PlayAnimDelayed @0x741CC0 (coroutine; iterator MoveNext @0x742EE0)
        private IEnumerator PlayAnimDelayed(float a_delay, string a_triggerName)
        {
            m_isDisableJump = true;
            yield return new WaitForSeconds(a_delay + Random.Range(0.25f, 1.5f)); // @0x00B7FE18 / 0x00B7FE1C
            m_Animator.SetTrigger(a_triggerName);
        }

        // Update @0x741D50
        private void Update()
        {
            float dt = Time.deltaTime;

            if (m_isFirstRun)
            {
                LastPos = Transform.position;
                m_isFirstRun = false;
            }

            if (!m_IsDead)
            {
                if (!m_IsBeingAttacked)
                    UpdatePosition(dt);
                else
                    DestPos = m_AttackedDestPos;    // flee the attacker
            }
            else
            {
                m_DeadTime -= dt;
                if (m_DeadTime <= 0.0f)
                {
                    ParticleGroup.FreeEffectsOnObjectDestroy(gameObject);
                    Object.DestroyObject(gameObject);
                    return;
                }
            }

            // Animation speed from actual frame-to-frame movement.
            float speed = (Transform.position - LastPos).magnitude;
            if (IsScared)
                speed = Mathf.Min(speed, 0.75f);                // @0x00B7FDC0
            if (speed <= 0.01f)                                 // @0x00B7FDC4
                speed = 0.0f;
            if (dt > 0.001f)                                    // @0x00B7FDC8
                speed /= dt;

            if (m_Animator != null)
            {
                m_Animator.SetFloat(m_AnimParam_MoveSpeed, speed);
                LastPos = Transform.position;
                m_Animator.SetBool(m_AnimParam_scared, IsScared);

                if (!IsScared && speed <= 0.0f && m_AnimParam_idleVariation != 0)
                {
                    m_randomIdleAnimTime -= dt;
                    if (m_randomIdleAnimTime <= 0.0f)
                    {
                        m_randomIdleAnimTime = Random.Range(randomIdleAnimIntervalMin, randomIdleAnimIntervalMax);
                        m_Animator.SetTrigger(m_AnimParam_idleVariation);
                    }
                }

                // Run sound only while actually moving.
                if (speed <= 0.1f || !EnableRunSound)           // @0x00B7FDCC
                {
                    MonstersAudio.Instance.StopSFX(audioSourceRun);
                    audioSourceRun = null;
                }
                else
                {
                    audioSourceRun = MonstersAudio.Instance.PlaySFXMonitored(
                        chibiRunSound, Transform.position, audioSourceRun);
                }
            }
        }

        // UpdatePosition @0x7421B0
        private void UpdatePosition(float dt)
        {
            if (!m_IsBlownUp)
            {
                if (!m_isDisableJump)
                {
                    m_jumpDelay = Mathf.Max(0.0f, m_jumpDelay - dt);
                    if (m_isOnGround)
                    {
                        if (m_jumpDelay <= 0.0f)
                        {
                            if (!m_IsPlayerClose)
                            {
                                if (m_IsEnemyClose || IsScared)
                                {
                                    // Panic jump.
                                    m_Animator.SetTrigger(m_AnimParam_PanicJump);
                                    m_Vel.y = Random.Range(PanicJumpMinVel, PanicJumpMaxVel);
                                    m_jumpDelay = Random.Range(0.5f, 1.5f);   // @0x00B7FDE0 / 0x00B7FDE4
                                    MonstersAudio.Instance.PlaySFX(chibiJumpSound, Transform.position);
                                }
                            }
                            else
                            {
                                // Happy jump toward the player.
                                m_Vel.y = Random.Range(3.0f, 5.0f);           // @0x00B7FDD0 / 0x00B7FDD4
                                m_jumpDelay = Random.Range(0.25f, 1.0f);      // @0x00B7FDD8 / 0x00B7FDDC
                                MonstersAudio.Instance.PlaySFX(chibiJumpSound, Transform.position);
                            }
                        }
                        else
                        {
                            m_Animator.SetTrigger(m_AnimParam_Land);
                        }
                    }
                }
            }
            else
            {
                // Blown up (e.g. bomb): recover once landed and falling.
                if (m_isOnGround && m_Vel.y < 0.0f)
                    m_IsBlownUp = false;
            }

            Vector3 toDest = DestPos - Transform.position;
            toDest.y = 0.0f;

            if (!m_isOnGround || toDest.magnitude > 0.01        // double 0.01 @0x00B7FF38
                || m_IsPlayerClose || m_IsEnemyClose)
            {
                float dist = toDest.magnitude;
                // Ease-out over the last ~0.2 units; brake hard near the target.
                float t = Mathf.Clamp01((dist - 0.01f) / 0.19f);              // @0x00B7FDE8 / 0x00B7FDEC
                float speedFactor = t * 2.5f;                                 // @0x00B7FDF0
                float acc = Mathf.Lerp(AccMax, AccMin, t);
                float newVelY = m_Vel.y + dt * -20.0f;                        // gravity @0x00B7FDF4

                Vector3 desiredVel = toDest.normalized * speedFactor;
                m_Vel = Vector3.MoveTowards(m_Vel, desiredVel, dt * acc);
                m_Vel.y = newVelY;

                Transform.position += m_Vel * dt;
                Transform.position = ProjectToGround(Transform.position);
            }

            // Face the player when close, else face the travel direction.
            float sqrMag = m_Vel.x * m_Vel.x + m_Vel.z * m_Vel.z;
            if (m_IsPlayerClose || sqrMag > 0.1f)                             // @0x00B7FDF8
            {
                Quaternion target;
                if (m_IsPlayerClose)
                {
                    Vector3 toPlayer = PlayerPos - Transform.position;
                    target = Quaternion.LookRotation(new Vector3(toPlayer.x, 0.0f, toPlayer.z), Vector3.up);
                }
                else
                {
                    target = Quaternion.LookRotation(new Vector3(m_Vel.x, 0.0f, m_Vel.z), Vector3.up);
                }
                Transform.rotation = Quaternion.RotateTowards(Transform.rotation, target, dt * 180.0f); // @0x00B7FDFC
            }
        }

        // BlowUp @0x742880
        public void BlowUp(Vector3 a_vel)
        {
            m_IsBlownUp = true;
            m_Vel = a_vel;
        }

        // ProjectToGround @0x7428A0
        // Snap Y to the terrain via linecast; keeps X/Z. While rising (vel.y >= 0)
        // and not forced, no projection happens and the chibi counts as airborne.
        public Vector3 ProjectToGround(Vector3 pos, bool force = false)
        {
            Vector3 start, end;
            if (!force)
            {
                if (m_Vel.y >= 0.0f)
                {
                    m_isOnGround = false;
                    return pos;
                }
                start = LastPos + Vector3.up * 1.0f;            // @0x00B7FE04
                end = pos + Vector3.down * 0.01f;               // @0x00B7FE08
            }
            else
            {
                start = pos + Vector3.up * 1.0f;                // @0x00B7FE04
                end = pos + Vector3.down * 10.0f;               // @0x00B7FE0C
            }

            RaycastHit hit;
            bool grounded = Physics.Linecast(start, end, out hit, Layers.Instance.TerrainMask);
            if (grounded)
            {
                pos.y = hit.point.y;
                m_Vel.y = 0.0f;
            }
            m_isOnGround = grounded;
            return pos;
        }

        // ProjectPosToGround @0x742B10 (static)
        public static Vector3 ProjectPosToGround(Vector3 pos)
        {
            Vector3 start = pos + Vector3.up * 1.0f;            // @0x00B7FE10
            Vector3 end = pos + Vector3.down * 10.0f;           // @0x00B7FE14
            RaycastHit hit;
            if (Physics.Linecast(start, end, out hit, Layers.Instance.TerrainMask))
                pos.y = hit.point.y;
            return pos;
        }

        // NotifyBeingAttacked @0x742CE0
        // Called by the enemy attack presentation: flee one unit away from the
        // attacker until the kill event lands.
        public void NotifyBeingAttacked(Transform a_attacker)
        {
            m_IsBeingAttacked = true;
            Vector3 away = (Transform.position - a_attacker.position).normalized;
            m_AttackedDestPos = Transform.position + away;
        }

        // OnEnemyAttackedMe @0x742DE0
        // UnityEvents.chibiKilledEvent callback: the sim removed this chibi.
        private void OnEnemyAttackedMe(GameCoreHome.ChibiData a_chibi)
        {
            if (a_chibi == null || ChibiId != a_chibi.id || m_IsDead)
                return;

            m_IsDead = true;
            m_DeadTime = 1.0f;                                  // 0x3F800000
            if (m_Animator != null)
            {
                m_Animator.SetTrigger("Die");
                MonstersAudio.Instance.PlaySFX(chibiDeathSound, transform.position);
            }
        }
    }
}